require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

const FEE_RATE = 3;
const FEE_CAP = 20;
const PREMIUM_PRICE = 49;
const PREMIUM_CREDIT = 30;
const PREMIUM_PLANS = new Map([[7,{price:15,credit:0,label:'Premium 7 วัน'}],[30,{price:49,credit:30,label:'Premium 30 วัน'}],[90,{price:129,credit:90,label:'Premium 3 เดือน'}]]);
const PROMO_PLANS = new Map([[3,15],[7,29],[14,49],[30,79],[60,129]]);
const APP_BASE_URL = process.env.APP_BASE_URL || '';

function publicBaseUrl(req){
  return APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function calcFee(price){ return Math.min(Math.round(Number(price) * FEE_RATE) / 100, FEE_CAP); }
function invoice(prefix='RU'){ return `${prefix}${Date.now()}${Math.random().toString(36).slice(2,7).toUpperCase()}`.slice(0,50); }
function twoc2pSign(payload){ return jwt.sign(payload, process.env.TWOC2P_SECRET_KEY, {algorithm:'HS256'}); }
function twoc2pDecode(token){ return jwt.verify(token, process.env.TWOC2P_SECRET_KEY, {algorithms:['HS256']}); }
async function twoc2pPost(endpoint, payload){
  const token = twoc2pSign(payload);
  const res = await fetch(`${process.env.TWOC2P_BASE_URL}/payment/${process.env.TWOC2P_API_VERSION}/${endpoint}`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({payload:token})
  });
  const body = await res.json();
  if(body.payload) return twoc2pDecode(body.payload);
  return body;
}

function currentUser(req){
  // Development bridge only. Production should replace this with real session/JWT auth.
  const email = String(req.headers['x-reuni-email'] || '').trim().toLowerCase();
  if(!email || !email.includes('@')) return null;
  return email;
}

app.get('/api/health', async (req,res)=>{
  try { await pool.query('SELECT 1'); res.json({ok:true,mysql:true,provider:process.env.TWOC2P_MERCHANT_ID?'configured':'not_configured'}); }
  catch(e){ res.status(500).json({ok:false,mysql:false,error:e.message}); }
});


app.post('/api/promotions/checkout', async (req,res)=>{
  const email=currentUser(req);
  if(!email) return res.status(401).json({error:'ต้องเข้าสู่ระบบ'});
  const productId=Number(req.body?.productId), planDays=Number(req.body?.days);
  const price=PROMO_PLANS.get(planDays)||0;
  if(!price) return res.status(400).json({error:'แพ็กเกจโปรโมตไม่ถูกต้อง'});
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [pRows]=await conn.query('SELECT id,name FROM products WHERE id=? AND seller_email=? AND status<>\'sold\' FOR UPDATE',[productId,email]);
    if(!pRows.length){await conn.rollback();return res.status(404).json({error:'ไม่พบสินค้าที่สามารถโปรโมตได้'});}
    const [uRows]=await conn.query('SELECT promo_credit,name FROM users WHERE email=? FOR UPDATE',[email]);
    const credit=Math.max(0,Number(uRows[0]?.promo_credit||0));
    const creditUsed=Math.min(credit,price), cashPaid=price-creditUsed;
    const start=new Date(), end=new Date(start); end.setDate(end.getDate()+planDays);
    if(cashPaid===0){
      await conn.query('UPDATE users SET promo_credit=promo_credit-? WHERE email=?',[creditUsed,email]);
      await conn.query('INSERT INTO promotions(user_email,product_id,days,package_price,credit_used,cash_paid,starts_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?)',[email,productId,planDays,price,creditUsed,0,start,end,'active']);
      await conn.commit();
      return res.json({ok:true,paid:false,active:true,amount:0,creditUsed});
    }
    const invoiceNo=invoice('PM');
    const [pay]=await conn.query('INSERT INTO payments(invoice_no,user_email,payment_type,reference_id,amount,status) VALUES(?,?,?,?,?,?)',[invoiceNo,email,'promotion',String(productId),cashPaid,'pending']);
    await conn.query('UPDATE users SET promo_credit=promo_credit-? WHERE email=?',[creditUsed,email]);
    await conn.query('INSERT INTO promotions(user_email,product_id,days,package_price,credit_used,cash_paid,payment_id,starts_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?)',[email,productId,planDays,price,creditUsed,cashPaid,pay.insertId,start,end,'pending']);
    const payload={merchantID:process.env.TWOC2P_MERCHANT_ID,invoiceNo,description:`ReUni โปรโมต ${pRows[0].name} ${planDays} วัน`,amount:cashPaid.toFixed(2),currencyCode:'THB',paymentChannel:['CC','QR'],locale:'th',frontendReturnUrl:`${publicBaseUrl(req)}/payment-return?invoiceNo=${encodeURIComponent(invoiceNo)}`,backendReturnUrl:`${publicBaseUrl(req)}/api/payments/2c2p/backend`,nonceStr:Math.random().toString(36).slice(2,14)};
    const result=await twoc2pPost('paymentToken',payload);
    if(result.respCode!=='0000'){
      await conn.rollback();
      return res.status(502).json({error:result.respDesc||'สร้างรายการชำระเงินไม่สำเร็จ'});
    }
    await conn.query('UPDATE payments SET provider_token=?,raw_response=? WHERE id=?',[result.paymentToken,JSON.stringify(result),pay.insertId]);
    await conn.commit();
    res.json({ok:true,paid:true,active:false,amount:cashPaid,creditUsed,invoiceNo,paymentToken:result.paymentToken,webPaymentUrl:result.webPaymentUrl});
  }catch(e){try{await conn.rollback()}catch{};res.status(500).json({error:e.message});}finally{conn.release();}
});

app.post('/api/payments/create', async (req,res)=>{
  const email=currentUser(req);
  if(!email) return res.status(401).json({error:'ต้องเข้าสู่ระบบ'});
  const {type, productId, days, orderNo} = req.body || {};
  const conn=await pool.getConnection();
  try{
    let amount=0, description='', referenceId=null;
    if(type==='premium') {
      const planDays=Number(days||30), plan=PREMIUM_PLANS.get(planDays);
      if(!plan) return res.status(400).json({error:'แพ็กเกจ Premium ไม่ถูกต้อง'});
      amount=plan.price; description=`ReUni ${plan.label}`; referenceId=String(planDays);
    }
    else if(type==='promotion') {
      const plan=Number(days); amount=PROMO_PLANS.get(plan)||0;
      if(!amount) return res.status(400).json({error:'แพ็กเกจโปรโมตไม่ถูกต้อง'});
      const [rows]=await conn.query('SELECT id,name FROM products WHERE id=? AND seller_email=? AND status<>\'sold\'', [productId,email]);
      if(!rows.length) return res.status(404).json({error:'ไม่พบสินค้าที่สามารถโปรโมตได้'});
      description=`ReUni โปรโมต ${rows[0].name} ${plan} วัน`; referenceId=String(productId);
    } else if(type==='sale') {
      if(!orderNo) return res.status(400).json({error:'ต้องระบุ orderNo'});
      const [rows]=await conn.query('SELECT * FROM orders WHERE order_no=? AND buyer_email=?', [orderNo,email]);
      if(!rows.length) return res.status(404).json({error:'ไม่พบรายการสั่งซื้อ'});
      if(rows[0].payment_status==='paid') return res.status(409).json({error:'รายการนี้ชำระเงินแล้ว'});
      amount=Number(rows[0].gross_amount); description=`ReUni สินค้า #${rows[0].product_id}`; referenceId=orderNo;
    } else return res.status(400).json({error:'ประเภทการชำระเงินไม่ถูกต้อง'});

    const invoiceNo=invoice(type==='premium'?'PR':type==='promotion'?'PM':'SO');
    const [r]=await conn.query('INSERT INTO payments(invoice_no,user_email,payment_type,reference_id,amount,status) VALUES(?,?,?,?,?,?)',[invoiceNo,email,type,referenceId,amount,'pending']);
    const payload={
      merchantID:process.env.TWOC2P_MERCHANT_ID,
      invoiceNo,description,amount:amount.toFixed(2),currencyCode:'THB',
      paymentChannel:['CC','QR'],
      locale:'th',
      frontendReturnUrl:`${publicBaseUrl(req)}/payment-return?invoiceNo=${encodeURIComponent(invoiceNo)}`,
      backendReturnUrl:`${publicBaseUrl(req)}/api/payments/2c2p/backend`,
      nonceStr:Math.random().toString(36).slice(2,14)
    };
    const result=await twoc2pPost('paymentToken',payload);
    if(result.respCode!=='0000'){
      await conn.query('UPDATE payments SET status=?,raw_response=? WHERE id=?',['failed',JSON.stringify(result),r.insertId]);
      return res.status(502).json({error:result.respDesc||'สร้างรายการชำระเงินไม่สำเร็จ'});
    }
    await conn.query('UPDATE payments SET provider_token=?,raw_response=? WHERE id=?',[result.paymentToken,JSON.stringify(result),r.insertId]);
    res.json({ok:true,invoiceNo,paymentToken:result.paymentToken,webPaymentUrl:result.webPaymentUrl});
  }catch(e){res.status(500).json({error:e.message});}finally{conn.release();}
});

app.post('/api/payments/2c2p/backend', async (req,res)=>{
  const conn=await pool.getConnection();
  try{
    const token=req.body?.payload;
    if(!token) return res.status(400).send('missing payload');
    const data=twoc2pDecode(token);
    await conn.query('INSERT INTO payment_events(invoice_no,provider,resp_code,resp_desc,payload) VALUES(?,?,?,?,?)',[data.invoiceNo,'2C2P',data.respCode,data.respDesc,JSON.stringify(data)]);
    const [rows]=await conn.query('SELECT * FROM payments WHERE invoice_no=? FOR UPDATE',[data.invoiceNo]);
    if(!rows.length) return res.status(404).send('invoice not found');
    const p=rows[0];
    if(data.respCode==='0000'){
      await conn.beginTransaction();
      if(p.status!=='paid') await conn.query('UPDATE payments SET status=?,provider_transaction_ref=?,raw_response=? WHERE id=?',['paid',data.tranRef||null,JSON.stringify(data),p.id]);
      if(p.payment_type==='premium'){
        const [existing]=await conn.query('SELECT id FROM premium_subscriptions WHERE payment_id=? LIMIT 1',[p.id]);
        if(!existing.length){
          const [u]=await conn.query('SELECT premium_until,promo_credit FROM users WHERE email=? FOR UPDATE',[p.user_email]);
          const planDays=Number(p.reference_id||30), plan=PREMIUM_PLANS.get(planDays)||PREMIUM_PLANS.get(30);
          const startDate=new Date(); const base=u[0]?.premium_until && new Date(u[0].premium_until)>startDate?new Date(u[0].premium_until):startDate; const expires=new Date(base); expires.setDate(expires.getDate()+planDays);
          const creditAdd=Number(plan.credit||0); const newCredit=Number(u[0]?.promo_credit||0)+creditAdd;
          await conn.query('INSERT INTO premium_subscriptions(user_email,payment_id,price,promo_credit,starts_at,expires_at,status) VALUES(?,?,?,?,?,?,?)',[p.user_email,p.id,plan.price,creditAdd,startDate,expires,'active']);
          await conn.query('INSERT INTO users(email,name,premium_until,promo_credit) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE premium_until=VALUES(premium_until),promo_credit=? ,updated_at=CURRENT_TIMESTAMP',[p.user_email,p.user_email,expires,newCredit,newCredit]);
        }
      }
      if(p.payment_type==='promotion') await conn.query('UPDATE promotions SET status=\'active\' WHERE payment_id=?',[p.id]);
      if(p.payment_type==='sale') await conn.query('UPDATE orders SET payment_status=\'paid\' WHERE order_no=?',[p.reference_id]);
      await conn.commit();
    }else await conn.query('UPDATE payments SET status=?,raw_response=? WHERE id=?',['failed',JSON.stringify(data),p.id]);
    res.send('OK');
  }catch(e){try{await conn.rollback()}catch{};res.status(500).send('ERROR');}finally{conn.release();}
});

app.get('/api/payments/:invoiceNo', async (req,res)=>{
  const [rows]=await pool.query('SELECT invoice_no,payment_type,reference_id,amount,currency,status,provider_transaction_ref,created_at,updated_at FROM payments WHERE invoice_no=?',[req.params.invoiceNo]);
  if(!rows.length) return res.status(404).json({error:'ไม่พบรายการ'});
  res.json(rows[0]);
});

// Serve the ReUni frontend from /public. The explicit / route makes the
// homepage work even when Express static-file index resolution is unavailable.
const publicDir = path.join(__dirname, 'public');
const publicIndex = path.join(publicDir, 'index.html');
const fallbackIndex = path.join(__dirname, 'public_index_tmp.html');

app.use(express.static(publicDir));

app.get('/', (req,res)=>{
  res.sendFile(publicIndex, err => {
    if (err && !res.headersSent) res.sendFile(fallbackIndex);
  });
});

// Client-side routes such as /payment-return should still load the SPA.
app.get('*',(req,res)=>{
  res.sendFile(publicIndex, err => {
    if (err && !res.headersSent) res.sendFile(fallbackIndex);
  });
});

const port=Number(process.env.PORT||10000);
app.listen(port, '0.0.0.0', ()=>console.log(`ReUni backend listening on 0.0.0.0:${port}`));
