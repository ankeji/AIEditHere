import { getSessionUser } from './service.js'

export async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req)
    if (!user) return res.status(401).json({ error: '请先登录' })
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}
