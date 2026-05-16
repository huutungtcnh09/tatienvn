import { useEffect, useMemo, useRef, useState } from "react";

export default function SearchableSelect({
  value,
  onChange,
  options = [],
  allLabel = "Tất cả",
  searchPlaceholder = "Gõ để tìm...",
  noResultsText = "Không tìm thấy kết quả phù hợp",
  className = ""
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});

  const normalizedOptions = useMemo(() => {
    return options.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description || "",
      keywords: option.keywords || ""
    }));
  }, [options]);

  const selectedOption = useMemo(() => {
    return normalizedOptions.find((option) => option.value === value) || null;
  }, [normalizedOptions, value]);

  useEffect(() => {
    setQuery(selectedOption?.label || "");
  }, [selectedOption]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    const updateDropdownPosition = () => {
      const target = inputRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setDropdownStyle({
        position: "fixed",
        top: `${Math.round(rect.bottom + 4)}px`,
        left: `${Math.round(rect.left)}px`,
        width: `${Math.round(rect.width)}px`,
        zIndex: 120
      });
    };

    updateDropdownPosition();

    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);
    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return normalizedOptions;
    return normalizedOptions.filter((option) => {
      const haystack = [option.label, option.description, option.keywords].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [normalizedOptions, query]);

  const handleSelect = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div className={`searchable-select ${className}`.trim()} ref={rootRef}>
      <div className="searchable-select__control">
        <input
          ref={inputRef}
          type="text"
          className="searchable-select__input"
          value={query}
          placeholder={searchPlaceholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) {
              onChange("");
            }
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setQuery(selectedOption?.label || "");
              setOpen(false);
            }, 120);
          }}
        />
        {value ? (
          <button
            type="button"
            className="searchable-select__clear"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setQuery("");
              onChange("");
              setOpen(true);
            }}
            aria-label="Xóa lựa chọn"
          >
            x
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="searchable-select__dropdown" style={dropdownStyle}>
          <button
            type="button"
            className={`searchable-select__option ${!value ? "selected" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => handleSelect("")}
          >
            <strong>{allLabel}</strong>
          </button>

          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`searchable-select__option ${value === option.value ? "selected" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(option.value)}
              >
                <strong>{option.label}</strong>
                {option.description ? <span>{option.description}</span> : null}
              </button>
            ))
          ) : (
            <div className="searchable-select__empty">{noResultsText}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}