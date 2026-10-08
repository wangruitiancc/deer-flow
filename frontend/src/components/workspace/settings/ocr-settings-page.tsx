"use client";

import { CloudIcon, HardDriveIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import { getPersonalMineruCredential, testPersonalMineruCredential, updatePersonalMineruCredential, useLawTenants, type PersonalMineruCredential } from "@/core/law";

import { SettingsSection } from "./settings-section";

export function OcrSettingsPage() {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const tenants = useLawTenants();
  const [tenantId, setTenantId] = useState("");
  const [credential, setCredential] = useState<PersonalMineruCredential | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!tenantId && tenants.data?.[0]) setTenantId(tenants.data[0].tenant.id);
  }, [tenantId, tenants.data]);
  useEffect(() => {
    let active = true;
    if (!tenantId) return;
    setCredential(null);
    setError("");
    getPersonalMineruCredential(tenantId).then(
      (value) => { if (active) setCredential(value); },
      (reason) => { if (active) setError(String(reason)); },
    );
    return () => { active = false; };
  }, [tenantId]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!credential || !apiKey.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await updatePersonalMineruCredential(tenantId, {
        expected_version: credential.version,
        api_key: apiKey.trim(),
      });
      setCredential(next);
      setApiKey("");
      setNotice(zh ? "已加密保存。供应商有效性尚未验证。" : "Encrypted token saved. Provider validation is pending.");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!credential?.configured) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await updatePersonalMineruCredential(tenantId, {
        expected_version: credential.version,
        revoke: true,
      });
      setCredential(next);
      setApiKey("");
      setNotice(zh ? "凭证已撤销，新任务不能使用。" : "Token revoked for new tasks.");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    if (!credential?.configured) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await testPersonalMineruCredential(tenantId);
      setCredential(next);
      setNotice(next.status === "auth_accepted"
        ? (zh ? "Token 鉴权已被接受；额度、结果质量和数据处理条件仍未验证。" : "Token authentication was accepted. Quota, result quality and data terms remain unverified.")
        : (zh ? "尚未确认 Token 有效性；不会因此启动识别。" : "Token validity is unconfirmed. Recognition will not start from this test."));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title={zh ? "OCR 与文档识别" : "OCR and document recognition"}
        description={zh ? "律所私有识别和能力侧云识别由管理员控制。个人 MinerU 凭证只用于本人发起的文档识别。" : "Private and platform OCR remain administrator managed. A personal MinerU token is limited to your own document recognition tasks."}
      >
        <div className="max-w-2xl space-y-4">
          <section className="rounded-lg border p-4">
            <h3 className="flex items-center gap-2 font-semibold"><HardDriveIcon className="size-5" />{zh ? "律所侧私有 OCR" : "Private OCR"}</h3>
            <p className="text-muted-foreground mt-2 text-sm">{zh ? "涉密材料使用经律所管理员验收的私有服务。" : "Use the firm's approved private service for confidential material."}</p>
          </section>
          <section className="rounded-lg border p-4">
            <h3 className="flex items-center gap-2 font-semibold"><CloudIcon className="size-5" />{zh ? "能力侧云 OCR" : "Platform cloud OCR"}<Badge variant="outline">{zh ? "平台托管" : "Managed"}</Badge></h3>
            <p className="text-muted-foreground mt-2 text-sm">{zh ? "平台凭据只保存在能力服务器；付费接续另行确认。" : "Platform credentials stay on the capability server. Paid continuation needs separate authorization."}</p>
          </section>
          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="flex items-center gap-2 font-semibold"><ShieldCheckIcon className="size-5" />{zh ? "个人 MinerU 凭证" : "Personal MinerU token"}</h3>
            <p className="text-muted-foreground text-sm">{zh ? "仅连接固定 MinerU 官方端点。旧 OCR 设置中的密钥不会自动启用；这里不接受模型、MCP、Skill 或自定义地址。" : "Only the fixed official MinerU endpoint is supported. Legacy OCR keys are not reactivated; model, MCP, Skill and custom endpoint credentials are excluded."}</p>
            {tenants.data && tenants.data.length > 1 && (
              <select aria-label={zh ? "选择律所" : "Select law firm"} className="border-input bg-background h-9 rounded-md border px-3 text-sm" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
                {tenants.data.map((item) => <option key={item.tenant.id} value={item.tenant.id}>{item.tenant.name}</option>)}
              </select>
            )}
            {credential && <p className="text-sm">{credential.configured ? `${zh ? "已保存" : "Saved"} ${credential.masked_key}` : (zh ? "未配置" : "Not configured")} · {zh ? "剩余额度：供应商未提供准确查询接口" : "Remaining quota: no reliable provider query"} · {zh ? "状态" : "Status"}: {credential.status}</p>}
            {credential && <p className="text-muted-foreground text-xs">{zh ? "本系统已成功识别" : "Successfully recognized here"} {credential.completed_pages_in_this_system ?? 0} {zh ? "页；不包含在 MinerU 外部使用的额度，也不是供应商账单。" : "pages; excludes activity outside this system and is not the provider bill."}</p>}
            <form onSubmit={save} className="flex flex-wrap items-center gap-2">
              <Input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={zh ? "输入新的 MinerU API Token" : "New MinerU API token"} aria-label={zh ? "MinerU API Token" : "MinerU API token"} className="min-w-48 flex-1" />
              <Button type="submit" disabled={!credential || busy || !apiKey.trim()}>{zh ? "保存或更换" : "Save or replace"}</Button>
              <Button type="button" variant="outline" disabled={!credential?.configured || busy} onClick={testConnection}>{zh ? "测试鉴权" : "Test authentication"}</Button>
              <Button type="button" variant="outline" disabled={!credential?.configured || busy} onClick={revoke}>{zh ? "撤销" : "Revoke"}</Button>
            </form>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
          </section>
        </div>
      </SettingsSection>
    </div>
  );
}
