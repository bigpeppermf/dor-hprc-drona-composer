import React, { useState, useEffect } from "react";
import { importEnv } from "./importEnv";
import { T, solidButton } from "./theme";

/**
 * Milestone 6: stage a block-built environment, then promote it into the user's
 * env dir (where it becomes selectable in the Composer and previews/submits via
 * the unchanged engine). The files are generated client-side and POSTed as
 * strings — see docs/design/environment-builder.md §4.7 (provisional).
 */
export default function SaveBar({
  schema,
  map,
  template,
  driver,
  utils,
  getBuilder,
  onLoad,
  errorCount = 0,
}) {
  const [name, setName] = useState("");
  const [staged, setStaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {kind:"ok"|"err", text}
  const [envs, setEnvs] = useState([]); // user environments available to edit

  const base = `${document.dashboard_url}/jobs/composer`;
  const hasSchema = Object.keys(schema || {}).length > 0;

  // Populate the "edit existing" dropdown with the user's environments.
  useEffect(() => {
    fetch(`${base}/environments`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((list) =>
        setEnvs(Array.isArray(list) ? list.filter((e) => e.is_user_env) : [])
      )
      .catch(() => {});
  }, [base]);

  const post = async (path, body) => {
    const res = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.details?.error || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  };

  const getJson = async (path) => {
    const res = await fetch(`${base}/${path}`, { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.details?.error || data?.message || `HTTP ${res.status}`);
    return data;
  };

  const loadByName = async (envName) => {
    const n = (envName || "").trim();
    if (!n) return;
    setBusy(true);
    setStatus(null);
    try {
      // Prefer saved blocks (builder.json); fall back to reconstructing from
      // the env's files for hand-authored / imported-from-repo environments.
      const saved = await getJson(`load_environment_builder?name=${encodeURIComponent(n)}`);
      if (saved.builder) {
        onLoad?.(saved.builder);
        setStatus({ kind: "ok", text: `Loaded "${n}" from saved blocks.` });
      } else {
        const files = await getJson(`environment_source?name=${encodeURIComponent(n)}`);
        onLoad?.(importEnv(files));
        setStatus({
          kind: "ok",
          text: `Imported "${n}" from its files. Review, then Stage to save as blocks.`,
        });
      }
      setName(n);
      setStaged(false);
    } catch (e) {
      setStatus({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const onLoadClick = () => loadByName(name);

  const onStage = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await post("stage_environment", {
        name,
        schema,
        map,
        template,
        driver,
        utils: utils || "",
        builder: getBuilder ? getBuilder() : undefined,
      });
      setStaged(true);
      setStatus({ kind: "ok", text: `Staged "${name.trim()}". Promote to use it in the Composer.` });
    } catch (e) {
      setStaged(false);
      setStatus({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const onPromote = async (overwrite = false) => {
    setBusy(true);
    setStatus(null);
    try {
      const data = await post("promote_environment", { name, overwrite });
      setStatus({
        kind: "ok",
        text: `Promoted "${data.env}" — open the Composer and pick it from your environments.`,
      });
    } catch (e) {
      // 409 → offer overwrite.
      if (/exists/i.test(e.message)) {
        setStatus({ kind: "err", text: `${e.message}` });
      } else {
        setStatus({ kind: "err", text: e.message });
      }
    } finally {
      setBusy(false);
    }
  };

  const canStage = name.trim().length > 0 && hasSchema && !busy;

  return (
    <div style={barStyle}>
      <select
        style={selectStyle}
        value=""
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          if (v) loadByName(v);
        }}
        title="Open one of your environments to edit"
      >
        <option value="">
          {envs.length ? "Edit existing…" : "No environments yet"}
        </option>
        {envs.map((e) => (
          <option key={e.env} value={e.env}>
            {(e.icon ? e.icon + " " : "") + e.env}
          </option>
        ))}
      </select>

      <span style={{ color: T.sub, fontSize: "0.8rem" }}>or</span>

      <input
        style={nameStyle}
        value={name}
        placeholder="new environment name"
        onChange={(e) => {
          setName(e.target.value);
          setStaged(false);
        }}
      />
      <button
        style={linkBtn}
        disabled={!name.trim() || busy}
        onClick={onLoadClick}
        title="Load a previously saved environment of this name onto the canvas"
      >
        Load
      </button>
      <button style={btn(canStage)} disabled={!canStage} onClick={onStage}>
        {busy ? "…" : "Stage"}
      </button>
      <button
        style={btn(staged && !busy)}
        disabled={!staged || busy}
        title={staged ? "" : "Stage first"}
        onClick={() => onPromote(false)}
      >
        Promote ▸
      </button>
      {staged && (
        <button
          style={linkBtn}
          disabled={busy}
          onClick={() => onPromote(true)}
          title="Replace an existing environment with this one"
        >
          overwrite
        </button>
      )}
      {!hasSchema && (
        <span style={{ color: "#888", fontSize: "0.78rem" }}>
          add schema blocks first
        </span>
      )}
      {errorCount > 0 && (
        <span style={{ color: T.err, fontSize: "0.78rem", fontWeight: 700 }}>
          {errorCount} error{errorCount > 1 ? "s" : ""} — see Checks
        </span>
      )}
      {status && (
        <span
          style={{
            fontSize: "0.78rem",
            color: status.kind === "ok" ? "#0a7d28" : "#b00020",
            marginLeft: "auto",
          }}
        >
          {status.text}
        </span>
      )}
    </div>
  );
}

const barStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  padding: "0.6rem 0.9rem",
  border: `1px solid ${T.line}`,
  borderRadius: T.radius,
  background: T.surface,
  boxShadow: T.shadow,
  flex: "0 0 auto",
};

const nameStyle = {
  padding: "0.4rem 0.55rem",
  border: `1px solid ${T.line}`,
  borderRadius: 6,
  fontSize: "0.85rem",
  width: 210,
  color: T.ink,
  background: T.surface,
  outline: "none",
};

const selectStyle = {
  padding: "0.4rem 0.55rem",
  border: `1px solid ${T.line}`,
  borderRadius: 6,
  fontSize: "0.85rem",
  color: T.ink,
  background: T.surface,
  cursor: "pointer",
  maxWidth: 220,
};

const btn = solidButton;

const linkBtn = {
  background: "none",
  border: "none",
  color: T.maroon,
  fontSize: "0.78rem",
  textDecoration: "underline",
  cursor: "pointer",
  padding: 0,
};
