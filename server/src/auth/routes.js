import express from 'express'
import { requireAuth } from './middleware.js'
import {
  requestRegisterCode,
  registerAccount,
  loginAccount,
  destroySession,
  sessionCookie,
  clearSessionCookie,
} from './service.js'

const router = express.Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

router.post(
  '/request-code',
  wrap(async (req, res) => {
    const data = await requestRegisterCode(req.body?.email)
    res.json(data)
  }),
)

router.post(
  '/register',
  wrap(async (req, res) => {
    const { user, session } = await registerAccount({
      email: req.body?.email,
      code: req.body?.code,
      password: req.body?.password,
      name: req.body?.name,
      req,
    })
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAgeSeconds))
    res.status(201).json({ user })
  }),
)

router.post(
  '/login',
  wrap(async (req, res) => {
    const { user, session } = await loginAccount({
      email: req.body?.email,
      password: req.body?.password,
      req,
    })
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAgeSeconds))
    res.json({ user })
  }),
)

router.post(
  '/logout',
  requireAuth,
  wrap(async (req, res) => {
    await destroySession(req)
    res.setHeader('Set-Cookie', clearSessionCookie())
    res.json({ ok: true })
  }),
)

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router
