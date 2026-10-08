"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { withBasePath } from "@/lib/site-path";

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("正在确认登录信息…");

  useEffect(() => {
    let active = true;

    async function finishSignIn() {
      const params = new URLSearchParams(window.location.search);
      const callbackError = params.get("error_description") ?? params.get("error");
      const code = params.get("code");

      if (callbackError) {
        if (active) { setStatus("error"); setMessage(callbackError); }
        return;
      }
      if (!code) {
        if (active) { setStatus("error"); setMessage("登录链接缺少确认信息，请返回首页重新登录。 "); }
        return;
      }

      try {
        const supabase = createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        if (!active) return;
        setStatus("success");
        setMessage("确认成功，正在返回家庭药箱…");
        window.setTimeout(() => window.location.replace(withBasePath("/")), 500);
      } catch (error) {
        if (!active) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "登录确认失败，请重新尝试。 ");
      }
    }

    void finishSignIn();
    return () => { active = false; };
  }, []);

  return (
    <main className="loading-page auth-callback-page">
      <div className={`callback-icon ${status}`}>
        {status === "loading" && <LoaderCircle className="callback-spinner" />}
        {status === "success" && <CheckCircle2 />}
        {status === "error" && <TriangleAlert />}
      </div>
      <h1>{status === "error" ? "登录确认没有完成" : "家庭药箱"}</h1>
      <p>{message}</p>
      {status === "error" && <a className="primary-button" href={withBasePath("/")}>返回首页</a>}
    </main>
  );
}
