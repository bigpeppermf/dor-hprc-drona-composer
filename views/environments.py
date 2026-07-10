from flask import (
    request,
    jsonify,
    current_app as app,
    send_from_directory,
    url_for,
)
import os
import re
import json
import shutil
from .error_handler import APIError, handle_api_error
from .utils import create_folder_if_not_exist, get_drona_dir, get_envs_dir
from .env_repo_manager import EnvironmentRepoManager

# Environment names map to directory names, so keep them filesystem-safe.
ENV_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]*$")

# Builder (M6) stages a generated environment here before the user promotes it
# into their real env dir. See docs/design/environment-builder.md §4.7.
STAGING_SUBDIR = ".drona_builder_staging"


ENV_ICON_DIR = os.path.abspath(os.path.join("static", "env-icons"))
ENV_ICON_FILENAME = "icon.png"
DEFAULT_ICON_FILENAME = "generic_puzzle.png"


def get_env_root_for_icon_source(source):
    if source == "system":
        return os.path.abspath("./environments")

    if source == "user":
        eres = get_envs_dir()
        if eres.get("ok"):
            return os.path.abspath(eres["path"])

    return None


def get_env_icon_path(env_root_path, env_name):
    if os.path.basename(env_name) != env_name:
        return None

    env_dir = os.path.abspath(os.path.join(env_root_path, env_name))
    icon_path = os.path.abspath(os.path.join(env_dir, ENV_ICON_FILENAME))

    # Only consider the conventional icon.png inside the environment directory.
    if not icon_path.startswith(env_dir + os.sep):
        return None

    if not os.path.isfile(icon_path):
        return None

    return icon_path


def get_env_icon_url(env_root_path, env_name):
    env_root_path = os.path.abspath(env_root_path)
    source = None
    for possible_source in ("system", "user"):
        source_root = get_env_root_for_icon_source(possible_source)
        if source_root and source_root == env_root_path:
            source = possible_source
            break

    if not source or not get_env_icon_path(env_root_path, env_name):
        return url_for("static", filename=f"env-icons/{DEFAULT_ICON_FILENAME}")

    # Serve icons through Flask so the browser receives a URL under the
    # Open OnDemand app prefix, never a filesystem path.
    return url_for(
        "job_composer.get_environment_icon_route",
        environment=env_name,
        source=source,
    )


def get_directories(path):
    """Get list of directories in a given path"""
    return [d for d in os.listdir(path) if os.path.isdir(os.path.join(path, d))]

def _get_environments():
    """Get list of all available environments (system and user)"""
    system_environments = []
    try:
        system_env_path = os.path.abspath("./environments")
        system_environments = [
            {
                "env": env,
                "src": system_env_path,
                "is_user_env": False,
                "icon": get_env_icon_url(
                    system_env_path,
                    env
                ),
            }
            for env in get_directories(system_env_path)
        ]
    except (PermissionError, FileNotFoundError, OSError):
        system_environments = []
    
    dd = get_drona_dir()
    if not dd["ok"]:
        return system_environments

    user_envs_path = request.args.get("user_envs_path")
    if user_envs_path is None:
        eres = get_envs_dir()
        if not eres["ok"]:
            return system_environments
        user_envs_path = eres["path"]
        try:
            create_folder_if_not_exist(user_envs_path)
        except (PermissionError, OSError):
            pass

    user_environments = []
    try:
        user_environments = get_directories(user_envs_path)
        user_environments = [
            {
                "env": env,
                "src": user_envs_path,
                "is_user_env": True,
                "icon": get_env_icon_url(user_envs_path, env),
            }
            for env in user_environments
        ]
    except (PermissionError, FileNotFoundError, OSError):
        user_environments = []

    environments = system_environments + user_environments
    return environments


def get_environment_icon_route(environment):
    """Serve icon.png from an allowed environment root, or the default icon."""
    source = request.args.get("source")

    safe_environment = os.path.basename(environment)
    if safe_environment != environment:
        return send_from_directory(ENV_ICON_DIR, DEFAULT_ICON_FILENAME)

    env_root_path = get_env_root_for_icon_source(source)
    if not env_root_path:
        return send_from_directory(ENV_ICON_DIR, DEFAULT_ICON_FILENAME)

    icon_path = get_env_icon_path(env_root_path, safe_environment)
    if not icon_path:
        return send_from_directory(ENV_ICON_DIR, DEFAULT_ICON_FILENAME)

    env_dir = os.path.dirname(icon_path)
    return send_from_directory(env_dir, ENV_ICON_FILENAME)

def get_environment_route(environment):
    """Get template file for a specific environment"""
    env_dir = request.args.get("src")
    if env_dir is None:
        template_path = os.path.join('environments', environment, 'template.txt')
    else:
        template_path = os.path.join(env_dir, environment, 'template.txt')

    if os.path.exists(template_path):
        template_data = open(template_path, 'r').read()
    else:
        raise FileNotFoundError(f"{template_path} not found")

    return template_data

@handle_api_error
def add_environment_route():
    """Add a new environment from the repository"""
    env = request.form.get("env")

    if not env:
        raise APIError(
            "Missing environment name parameter",
            status_code=400,
            details={'error': 'The "env" parameter is required'}
        )

    repo_manager = EnvironmentRepoManager(
            repo_url=app.config['env_repo_github'],
            repo_dir="./environments-repo"
    )
    eres = get_envs_dir()
    if not eres["ok"]:
        return jsonify({"message": eres["reason"]}), 400
    user_envs_dir = eres["path"]


    try:
        repo_manager.copy_environment_to_user(env, user_envs_dir)
        return jsonify({"status": "Success"})
    except ValueError as e:
        raise APIError(
            "Invalid input",
            status_code=400,
            details={'error': str(e)}
        )
    except FileNotFoundError as e:
        raise APIError(
            "Environment not found",
            status_code=404,
            details={'error': str(e)}
        )
    except PermissionError as e:
        raise APIError(
            "Permission denied",
            status_code=403,
            details={'error': str(e)}
        )
    except RuntimeError as e:
        raise APIError(
            "Git operation failed",
            status_code=500,
            details={'error': str(e)}
        )
    except Exception as e:
        raise APIError(
            "Unexpected error while adding environment",
            status_code=500,
            details={'error': str(e)}
        )

def get_environments_route():
    """Get list of all available environments"""
    environments = _get_environments()
    return jsonify(environments)

@handle_api_error
def delete_environment_route():
    """Delete a user environment."""
    data = request.get_json(silent=True) or {}
    env = data.get("env")

    if not env:
        raise APIError(
            "Missing environment name parameter",
            status_code=400,
            details={"error": 'The "env" parameter is required'}
        )

    eres = get_envs_dir()
    if not eres["ok"]:
        return jsonify({"message": eres["reason"]}), 400

    user_envs_dir = os.path.abspath(eres["path"])
    env_path = os.path.abspath(os.path.join(user_envs_dir, env))

    # Prevent path traversal like "../../../something"
    if not env_path.startswith(user_envs_dir + os.sep):
        raise APIError(
            "Invalid environment path",
            status_code=400,
            details={"error": "Invalid environment path"}
        )

    if not os.path.isdir(env_path):
        raise APIError(
            "Environment not found",
            status_code=404,
            details={"error": f'Environment "{env}" was not found'}
        )

    try:
        shutil.rmtree(env_path)
    except PermissionError as e:
        raise APIError(
            "Permission denied",
            status_code=403,
            details={"error": str(e)}
        )
    except OSError as e:
        raise APIError(
            "Failed to delete environment",
            status_code=500,
            details={"error": str(e)}
        )

    return jsonify({
        "status": "Success",
        "message": f'Deleted environment "{env}"',
        "env": env
    })

def get_more_envs_info_route():
    """Get additional information about available environments from the repository"""
    cluster_name = app.config['cluster_name']
    repo_manager = EnvironmentRepoManager(
        repo_url=app.config["env_repo_github"],
        repo_dir="./environments-repo"
    )

    environments_info = repo_manager.get_environments_info(cluster_name)
    return jsonify(environments_info)

def _validate_env_name(name):
    """Validate an env name and return it, or raise APIError (400)."""
    if not name or not isinstance(name, str):
        raise APIError("Missing environment name", status_code=400,
                       details={"error": 'The "name" parameter is required'})
    name = name.strip()
    if name in (".", "..") or not ENV_NAME_RE.match(name) or os.sep in name or "/" in name:
        raise APIError("Invalid environment name", status_code=400,
                       details={"error": "Use letters, numbers, spaces, '.', '_', '-'."})
    return name


def _get_staging_dir():
    """Staging root under the drona dir, or raise APIError."""
    dd = get_drona_dir()
    if not dd.get("ok"):
        raise APIError("drona_dir not configured", status_code=400,
                       details={"error": dd.get("reason", "unknown")})
    return os.path.join(dd["drona_dir"], STAGING_SUBDIR)


@handle_api_error
def stage_environment_route():
    """
    Milestone 6: stage a block-built environment.

    The builder generates the files client-side and POSTs the strings; we write
    them to a staging dir. The user then promotes it (see promote route) into
    their real env dir, where it flows through the unchanged preview/submit
    pipeline. PROVISIONAL design — see design doc §4.7.
    """
    data = request.get_json(silent=True) or {}
    name = _validate_env_name(data.get("name"))

    schema = data.get("schema")
    env_map = data.get("map")
    template = data.get("template", "")
    driver = data.get("driver", "")
    utils = data.get("utils", "")
    builder = data.get("builder")  # optional Blockly workspace serialization

    if not isinstance(schema, dict) or not isinstance(env_map, dict):
        raise APIError("Invalid payload", status_code=400,
                       details={"error": '"schema" and "map" must be objects'})

    # The standard driver block emits `cd [flocation]`; that placeholder only
    # resolves if `flocation` is a map key. Inject it so block-built drivers work.
    if "[flocation]" in driver and "flocation" not in env_map:
        env_map["flocation"] = "$location"

    staging_root = _get_staging_dir()
    env_path = os.path.abspath(os.path.join(staging_root, name))
    if not env_path.startswith(os.path.abspath(staging_root) + os.sep):
        raise APIError("Invalid environment path", status_code=400,
                       details={"error": "path traversal blocked"})

    # Fresh stage each time.
    if os.path.isdir(env_path):
        shutil.rmtree(env_path)
    create_folder_if_not_exist(env_path)

    with open(os.path.join(env_path, "schema.json"), "w") as f:
        json.dump(schema, f, indent=2)
    with open(os.path.join(env_path, "map.json"), "w") as f:
        json.dump(env_map, f, indent=2)
    with open(os.path.join(env_path, "template.txt"), "w") as f:
        f.write(template)
    with open(os.path.join(env_path, "driver.sh"), "w") as f:
        f.write(driver)
    with open(os.path.join(env_path, "utils.py"), "w") as f:
        f.write(utils)
    if builder is not None:
        with open(os.path.join(env_path, "builder.json"), "w") as f:
            json.dump(builder, f, indent=2)

    return jsonify({
        "status": "Success",
        "name": name,
        "staging_path": env_path,
        "files": ["schema.json", "map.json", "template.txt", "driver.sh", "utils.py"],
    })


@handle_api_error
def promote_environment_route():
    """
    Milestone 6: promote a staged environment into the user's env dir so it
    becomes selectable in the Composer. PROVISIONAL design — see design doc §4.7.
    """
    data = request.get_json(silent=True) or {}
    name = _validate_env_name(data.get("name"))
    overwrite = bool(data.get("overwrite", False))

    staging_root = os.path.abspath(_get_staging_dir())
    src = os.path.abspath(os.path.join(staging_root, name))
    if not src.startswith(staging_root + os.sep) or not os.path.isdir(src):
        raise APIError("Staged environment not found", status_code=404,
                       details={"error": f'Stage "{name}" first'})

    eres = get_envs_dir()
    if not eres["ok"]:
        return jsonify({"message": eres["reason"]}), 400
    envs_dir = os.path.abspath(eres["path"])
    create_folder_if_not_exist(envs_dir)
    dest = os.path.abspath(os.path.join(envs_dir, name))
    if not dest.startswith(envs_dir + os.sep):
        raise APIError("Invalid environment path", status_code=400,
                       details={"error": "path traversal blocked"})

    if os.path.isdir(dest):
        if not overwrite:
            raise APIError("Environment already exists", status_code=409,
                           details={"error": f'"{name}" exists; pass overwrite=true to replace'})
        shutil.rmtree(dest)

    shutil.copytree(src, dest)
    return jsonify({"status": "Success", "env": name, "path": dest})


@handle_api_error
def load_environment_builder_route():
    """
    Milestone 7: return the saved builder.json (Blockly workspace) for an env so
    the user can reopen and keep editing it. `from` selects staging vs the real
    env dir (default: env dir). Returns { exists, builder } — builder is null if
    the env has no builder.json (e.g. a hand-authored env).
    """
    name = _validate_env_name(request.args.get("name"))
    source = request.args.get("from", "envs")

    if source == "staging":
        base = os.path.abspath(_get_staging_dir())
    else:
        eres = get_envs_dir()
        if not eres["ok"]:
            return jsonify({"message": eres["reason"]}), 400
        base = os.path.abspath(eres["path"])

    env_path = os.path.abspath(os.path.join(base, name))
    if not env_path.startswith(base + os.sep):
        raise APIError("Invalid environment path", status_code=400,
                       details={"error": "path traversal blocked"})
    if not os.path.isdir(env_path):
        raise APIError("Environment not found", status_code=404,
                       details={"error": f'No environment "{name}"'})

    builder_path = os.path.join(env_path, "builder.json")
    if not os.path.isfile(builder_path):
        return jsonify({"exists": True, "builder": None,
                        "message": "No builder.json (not block-built)."})

    with open(builder_path) as f:
        builder = json.load(f)
    return jsonify({"exists": True, "builder": builder})


@handle_api_error
def environment_source_route():
    """
    Phase B (reverse-import): return a user environment's four source files so
    the builder can reconstruct it as blocks. schema/map are parsed JSON;
    template/driver are raw text. Missing files come back empty.
    """
    name = _validate_env_name(request.args.get("name"))

    eres = get_envs_dir()
    if not eres["ok"]:
        return jsonify({"message": eres["reason"]}), 400
    base = os.path.abspath(eres["path"])
    env_path = os.path.abspath(os.path.join(base, name))
    if not env_path.startswith(base + os.sep):
        raise APIError("Invalid environment path", status_code=400,
                       details={"error": "path traversal blocked"})
    if not os.path.isdir(env_path):
        raise APIError("Environment not found", status_code=404,
                       details={"error": f'No environment "{name}"'})

    def read_json(fname):
        p = os.path.join(env_path, fname)
        if not os.path.isfile(p):
            return {}
        with open(p) as f:
            return json.load(f)

    def read_text(fname):
        p = os.path.join(env_path, fname)
        if not os.path.isfile(p):
            return ""
        with open(p) as f:
            return f.read()

    return jsonify({
        "name": name,
        "schema": read_json("schema.json"),
        "map": read_json("map.json"),
        "template": read_text("template.txt"),
        "driver": read_text("driver.sh"),
    })


def register_environment_routes(blueprint):
    """Register all environment-related routes to the blueprint"""
    blueprint.route('/environment/<environment>', methods=['GET'])(get_environment_route)
    blueprint.route('/environment_icon/<environment>', methods=['GET'])(get_environment_icon_route)
    blueprint.route('/environments', methods=['GET'])(get_environments_route)
    blueprint.route('/add_environment', methods=['POST'])(add_environment_route)
    blueprint.route('/get_more_envs_info', methods=['GET'])(get_more_envs_info_route)
    blueprint.route('/environment', methods=['DELETE'])(delete_environment_route)
    blueprint.route('/stage_environment', methods=['POST'])(stage_environment_route)
    blueprint.route('/promote_environment', methods=['POST'])(promote_environment_route)
    blueprint.route('/load_environment_builder', methods=['GET'])(load_environment_builder_route)
    blueprint.route('/environment_source', methods=['GET'])(environment_source_route)
