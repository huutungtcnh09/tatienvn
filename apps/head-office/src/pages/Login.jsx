import { useState } from "react";

export default function Login({ onLogin, loading }) {
  const [email, setEmail] = useState("admin@domain.com");
  const [password, setPassword] = useState("123456");

  const submit = (e) => {
    e.preventDefault();
    onLogin(email, password);
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <h1>Đăng nhập Head Office</h1>
        <p>Quản trị tập trung toàn công ty</p>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
        <label>Mật khẩu</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={loading}>{loading ? "Đang xử lý..." : "Đăng nhập"}</button>
      </form>
    </div>
  );
}
