import { Router } from 'express'
import express from 'express'
import auth from '../../middleware/auth.js'
import { asyncHandler } from '../../utils/errorHandling.js'
import { createOrder, webHook } from './order.controller.js'
const router = Router()

router.get('/', (req, res) => {
  res.status(200).json({ message: 'order Module' })
})

router.post('/', auth(), asyncHandler(createOrder))


//this function require a buffer data not json so we need to execlude it from passing througth the express.json() middleware
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  asyncHandler(webHook),
)

export default router
