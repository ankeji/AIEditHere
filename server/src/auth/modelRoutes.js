import express from 'express'
import { requireAuth } from './middleware.js'
import {
  listUserModels,
  getDefaultUserModel,
  createUserModel,
  updateUserModel,
  deleteUserModel,
} from './models.js'

const router = express.Router()
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

router.get('/models', requireAuth, wrap(async (req, res) => {
  const userId = req.user.id
  const models = await listUserModels(userId)
  const [defaultModel] = models.filter((item) => item.isDefault && item.enabled)
  res.json({ models, defaultModel })
}))

router.get('/models/default', requireAuth, wrap(async (req, res) => {
  const model = await getDefaultUserModel(req.user.id)
  res.json({ defaultModel: model || null })
}))

router.post('/models', requireAuth, wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const providerId = String(req.body?.providerId || '').trim()
  const modelId = String(req.body?.modelId || '').trim()
  const isDefault = Boolean(req.body?.isDefault)
  if (!name) throw new HttpError400('模型名称不能为空')
  if (!providerId) throw new HttpError400('请填写提供商 ID')
  if (!modelId) throw new HttpError400('请填写模型 ID')
  const created = await createUserModel(req.user.id, { name, providerId, modelId, isDefault })
  res.status(201).json({ model: created })
}))

router.patch('/models/:id', requireAuth, wrap(async (req, res) => {
  const updated = await updateUserModel(req.user.id, req.params.id, req.body || {})
  if (!updated) return res.status(404).json({ error: '模型不存在' })
  res.json({ model: updated })
}))

router.delete('/models/:id', requireAuth, wrap(async (req, res) => {
  const ok = await deleteUserModel(req.user.id, req.params.id)
  if (!ok) return res.status(404).json({ error: '模型不存在' })
  res.json({ ok: true })
}))

function HttpError400(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

export default router
