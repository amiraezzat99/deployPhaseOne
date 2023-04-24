import Stripe from 'stripe'
import cartModel from '../../../DB/model/Cart.model.js'
import couponModel from '../../../DB/model/Coupon.model.js'
import orderModel from '../../../DB/model/Order.model.js'
import productModel from '../../../DB/model/Product.model.js'
import payment from '../../utils/payment.js'
import { createInvoice } from '../../utils/pdfkit.js'
import sendEmail from '../../utils/sendEmail.js'
import { validateCoupon } from '../coupon/coupon.controller.js'

export const createOrder = async (req, res, next) => {
  const userId = req.user._id
  const { products, address, phone, couponCode, paymentMethod } = req.body

  // validation coupon
  if (couponCode) {
    const coupon = await couponModel.findOne({ code: couponCode })
    if (!coupon) {
      return next(new Error('in-valid coupon code', { cause: 400 }))
    }
    const { matched, exceed, expired } = validateCoupon(coupon, userId)
    if (!matched) {
      return next(new Error('not assgined', { cause: 400 }))
    }
    if (exceed) {
      return next(new Error('you exceed the max usgae', { cause: 400 }))
    }
    if (expired) {
      return next(new Error('this coupon is expired', { cause: 400 }))
    }
    req.body.coupon = coupon
  }
  if (!products?.length) {
    const cart = await cartModel.findOne({ userId })
    if (!cart?.products?.length) {
      return next(new Error('empty cart', { cause: 400 }))
    }
    req.body.isCart = true
    req.body.products = cart.products
  }

  //products validation
  let subTotal = 0
  let finalProductList = []
  let productIds = []
  for (let product of req.body.products) {
    const findProduct = await productModel.findOne({
      _id: product.productId,
      stock: { $gte: product.quantity },
      isDeleted: false,
    })
    if (!findProduct) {
      return next(new Error('in-valid product id', { cause: 400 }))
    }
    if (req.body.isCart) {
      product = product.toObject()
    }
    productIds.push(findProduct._id)
    product.name = findProduct.name
    product.productPrice = findProduct.priceAfterDiscount
    product.finalPrice = Number.parseFloat(
      product.quantity * findProduct.priceAfterDiscount,
    ).toFixed(2)
    finalProductList.push(product)
    subTotal += parseInt(product.finalPrice) // subTotal = subTotal +parseInt(product.finalPrice)
  }

  paymentMethod == 'cash'
    ? (req.body.orderStatus = 'placed')
    : (req.body.orderStatus = 'pending')

  const orderObject = {
    userId,
    products: finalProductList,
    address,
    phone,
    paymentMethod,
    orderStatus: req.body.orderStatus,
    subTotal,
    couponId: req.body.coupon?._id,
    totalPrice: Number.parseFloat(
      subTotal * (1 - (req.body.coupon?.amount || 0) / 100),
    ).toFixed(2),
  }

  const order = await orderModel.create(orderObject)
  if (order) {
    // decrement product's stock => qunatity
    for (const product of order.products) {
      await productModel.findByIdAndUpdate(product.productId, {
        // stock: { $inc: -parseInt(product.quantity) }
        $inc: { stock: -parseInt(product.quantity) },
      })
    }

    // increment coupon's usageCount by 1
    if (req.body.coupon) {
      for (const user of req.body.coupon?.usagePerUser) {
        if (user.userId.toString() == order.userId.toString()) {
          user.usageCount = user.usageCount + 1
        }
      }
      await req.body.coupon.save()
    }

    // remove from userCart
    await cartModel.findOneAndUpdate(
      { userId },
      {
        $pull: {
          products: {
            productId: {
              $in: productIds,
            },
          },
        },
      },
    )
    // generte pdf for order
    const invoice = {
      shipping: {
        name: req.user.userName,
        address: order.address,
        city: 'Cairo',
        state: 'Cairo',
        country: 'Egypt',
        postal_code: 94111,
      },
      items: order.products,
      subtotal: order.subTotal,
      total: order.totalPrice,
      invoice_nr: order._id,
      date: order.createdAt,
    }
    console.log(process.env.CANCEL_URL)
    // await createInvoice(invoice, "invoice.pdf");
    // await sendEmail({ to: req.user.email, message: "This is your order invoice", subject: "Order Invoice", attachments: [{ path: "invoice.pdf", contentType: "application/json" }] });
    if (order.paymentMethod == 'card') {
      const stripe = new Stripe(process.env.SERCRET_KEY)
      console.log(req.body.coupon)
      if (req.body.coupon) {
        const couponStripe = await stripe.coupons.create({
          percent_off: req.body.coupon.amount,
        })
        console.log(couponStripe)
        req.body.couponId = couponStripe.id
      }
      const session = await payment({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: req.user.email,
        metadata: {
          orderId: order._id.toString(), // to be used in webhook
          phone: order.phone[0],
        },
        cancel_url: `${process.env.CANCEL_URL}?orderId=${order._id}`,
        success_url: `${process.env.SUCCESS_URL}?orderId=${order._id}`,
        line_items: order.products.map((product) => {
          return {
            price_data: {
              currency: 'EGP',
              product_data: {
                name: product.name,
              },
              unit_amount: product.productPrice * 100, // convert from قرش to جنيه
            },
            quantity: product.quantity,
          }
        }),
        discounts: req.body.couponId ? [{ coupon: req.body.couponId }] : [],
      })
      return res.status(201).json({ message: 'Done', order, session })
    }
  }
  return res.status(201).json({ message: 'Done', order })
}
// if (order.paymentMethod == 'card') {
//   const session = await payment({
//     payment_method_types: ['card'],
//     mode: 'payment',
//     customer_email: req.user.email,
//     metadata: {
//       orderId: order._id.toString(),
//       phone: order.phone[0],
//     },
//     cancel_url: `${process.env.CANCEL_URL}?orderId=${order._id}`,
//     success_url: `${process.env.SUCCESS_URL}?orderId=${order._id}`,
//     line_items: order.products.map((product) => {
//       return {
//         price_data: {
//           currency: 'usd',
//           product_data: {
//             name: product.name,
//           },
//           unit_amount: product.productPrice,
//         },
//         quantity: product.quantity,
//       }
//     }),
//   })
//   return res.status(201).json({ message: 'Done', order, session })
// }

//========================================== web hook ========================
export const webHook = async (req, res, next) => {
  const stripe = new Stripe(process.env.SERCRET_KEY)
  const endpointSecret = process.env.EVENT_SECRET
  const sig = req.headers['stripe-signature']

  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret)
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }
  const { orderId } = event.data.object.metadata
  if (event.type != 'checkout.session.completed') {
    await orderModel.updateOne(
      { _id: orderId },
      { orderStatus: 'payment failed' },
    )
    return res
      .status(400)
      .json({ message: 'you payment is failed please try again later' })
  }
  await orderModel.updateOne({ _id: orderId }, { orderStatus: 'confirmed' })
  return res.status(200).json({ message: 'you payment is fsuccessed' })
  // Handle the event
  // switch (event.type) {
  //   case 'checkout.session.async_payment_failed':
  //     const checkoutSessionAsyncPaymentFailed = event.data.object
  //     // Then define and call a function to handle the event checkout.session.async_payment_failed
  //     break
  //   case 'checkout.session.async_payment_succeeded':
  //     const checkoutSessionAsyncPaymentSucceeded = event.data.object
  //     // Then define and call a function to handle the event checkout.session.async_payment_succeeded
  //     break
  //   case 'checkout.session.completed':
  //     const checkoutSessionCompleted = event.data.object
  //     // Then define and call a function to handle the event checkout.session.completed
  //     break
  //   case 'checkout.session.expired':
  //     const checkoutSessionExpired = event.data.object
  //     // Then define and call a function to handle the event checkout.session.expired
  //     break
  //   // ... handle other event types
  //   default:
  //     console.log(`Unhandled event type ${event.type}`)
  // }

  // // Return a 200 response to acknowledge receipt of the event
  // response.send()
}
