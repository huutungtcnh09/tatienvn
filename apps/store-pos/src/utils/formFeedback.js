import { useState } from "react";

export function useFormError(initial = "") {
  const [error, setError] = useState(initial);

  return {
    error,
    setError,
    clearError: () => setError(initial)
  };
}

export function useFieldErrors(initial = {}) {
  const [errors, setErrors] = useState(initial);

  return {
    errors,
    setErrors,
    clearErrors: () => setErrors(initial),
    clearFieldError: (field) => setErrors((prev) => ({ ...prev, [field]: "" }))
  };
}

export function usePageNotice(initial = { type: "", text: "" }) {
  const [notice, setNotice] = useState(initial);

  return {
    notice,
    setNotice,
    clearNotice: () => setNotice(initial),
    setErrorNotice: (text) => setNotice({ type: "error", text }),
    setSuccessNotice: (text) => setNotice({ type: "success", text })
  };
}
