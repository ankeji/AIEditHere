import nodemailer from 'nodemailer'
import { authConfig, mailConfigured } from './config.js'

let transporter = null

function getTransporter() {
  if (transporter) return transporter
  const smtp = authConfig.smtp
  const options = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  }
  if (smtp.user) {
    options.auth = { user: smtp.user, pass: smtp.pass }
  }
  transporter = nodemailer.createTransport(options)
  return transporter
}

function codeHtml(code) {
  return `
  <div style="max-width:520px;margin:0 auto;padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#232d3b">
    <div style="font-size:18px;font-weight:700;color:#2c9d6e;margin-bottom:10px">AIEditHere</div>
    <p style="font-size:14px;line-height:1.7">你正在注册 AIEditHere 账号，本次验证码为：</p>
    <div style="margin:18px 0;padding:16px 20px;border-radius:12px;background:#e9f8f1;color:#1d7a55;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center">${code}</div>
    <p style="font-size:13px;color:#8a93a2;line-height:1.7">验证码 ${authConfig.codeTtlMinutes} 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p>
  </div>`
}

export async function sendVerificationEmail(email, code) {
  if (!mailConfigured()) {
    console.log(`\n[auth] 未配置 SMTP，注册验证码 for ${email}: ${code}\n`)
    return {
      delivered: false,
      reason: 'missing_smtp',
      devCode: authConfig.allowDevCode ? code : '',
    }
  }
  await getTransporter().sendMail({
    from: authConfig.smtp.from,
    to: email,
    subject: 'AIEditHere 注册验证码',
    text: `你正在注册 AIEditHere，验证码：${code}，${authConfig.codeTtlMinutes} 分钟内有效。`,
    html: codeHtml(code),
  })
  return { delivered: true, devCode: '' }
}
