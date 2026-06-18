// react-select applies these as inline styles; CSS var() strings resolve in the
// browser, so the dropdowns follow the active site theme automatically.
export const customSelectStyles = {
  control: (provided, state) => ({
    ...provided,
    backgroundColor: state.isDisabled ? "var(--surface-muted)" : "var(--surface)",
    borderColor: state.isFocused ? "var(--accent)" : "var(--border)",
    borderRadius: ".25rem",
    minHeight: "38px",
    boxShadow: state.isFocused
      ? "0 0 0 .2rem color-mix(in srgb, var(--accent) 22%, transparent)"
      : "none",
    fontSize: "1rem",
  }),
  menu: (provided) => ({
    ...provided,
    backgroundColor: "var(--surface)",
    zIndex: 9999,
  }),
  menuPortal: (provided) => ({
    ...provided,
    zIndex: 9999,
  }),
  singleValue: (provided) => ({
    ...provided,
    color: "var(--app-text)",
  }),
  input: (provided) => ({
    ...provided,
    color: "var(--app-text)",
  }),
  option: (provided, state) => ({
    ...provided,
    backgroundColor: state.isFocused ? "var(--surface-muted)" : "var(--surface)",
    color: "var(--app-text)",
    padding: "8px 12px",
    "&:hover": {
      backgroundColor: "var(--surface-muted)",
    },
    ...state.data.styles,
  }),
  dropdownIndicator: (provided) => ({
    ...provided,
    padding: "4px",
  }),
  placeholder: (provided) => ({
    ...provided,
    color: "var(--text-sub)",
  }),
};
