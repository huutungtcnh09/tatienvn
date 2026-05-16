import { useState } from "react";

export default function Login({ onLogin, onClearSession }) {
  const [email, setEmail] = useState("huutungtcnh09@gmail.com");
  const [password, setPassword] = useState("123456");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      setErrorMessage("");
      await onLogin(email, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Đăng nhập thất bại";
      setErrorMessage(message || "Đăng nhập thất bại");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <h1>Store POS</h1>
      <p>Vận hành bán hàng tại cửa hàng</p>
      {errorMessage ? <div className="login-error">{errorMessage}</div> : null}
      <label>Email</label>
      <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      <label>Mật khẩu</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      <div className="login-actions">
        <button type="button" className="btn-cancel" onClick={onClearSession}>Xóa phiên cũ</button>
        <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Đang đăng nhập..." : "Đăng nhập"}</button>
      </div>
    </form>
  );
}
