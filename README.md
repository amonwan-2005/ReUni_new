# ReUni — Phase 1: MySQL + Payment Gateway

ชุดนี้เป็นฐาน Backend สำหรับ ReUni โดย **ไม่เปลี่ยนหน้าตาเว็บเดิม** และใช้แนวทาง Phase 1 ตามที่ตกลงกัน:

- เงิน Premium / โปรโมต: ชำระผ่าน Payment Gateway แล้ว Settlement ไปยังบัญชี Merchant ของเจ้าของ ReUni
- รายการขาย: เก็บยอดขายและค่าธรรมเนียมไว้ใน MySQL เพื่อเตรียมระบบต่อยอด
- ค่าธรรมเนียมการขาย: 3% แต่ไม่เกิน 20 บาท/รายการ
- ยังไม่มีการโอนเงินอัตโนมัติให้ผู้ขาย (Seller Payout)
- ยังไม่เก็บเลขบัญชีธนาคารของผู้ขายใน Phase 1

## ราคา
- Premium: 49 บาท/เดือน
- เครดิตโปรโมต Premium: 30 บาท/เดือน
- Promotion: 3/7/14/30/60 วัน = 15/29/49/79/129 บาท
- Sales fee: 3% ของราคาขาย สูงสุด 20 บาท/รายการ

## ขั้นตอนติดตั้ง
1. ติดตั้ง Node.js และ MySQL
2. สร้างฐานข้อมูลด้วย `schema.sql`
3. รัน `npm install`
4. คัดลอก `.env.example` เป็น `.env`
5. ใส่ค่า MySQL และ 2C2P Sandbox credentials
6. รัน `npm start`
7. เปิด `http://localhost:3000`

## ก่อนรับเงินจริง
Sandbox ใช้ทดสอบเท่านั้น ต้องเปลี่ยนเป็น Production credentials ของ Merchant ที่ได้รับอนุมัติจาก Payment Gateway และต้อง deploy Backend ด้วย HTTPS/public URL เพื่อให้ provider เรียก Backend Payment Response ได้

**ห้ามใส่ Secret Key ใน HTML/JavaScript ฝั่งผู้ใช้**

## สำคัญ
ตอนนี้หน้าเว็บยังมี localStorage/browser state เพื่อรักษาหน้าตาและฟังก์ชันเดิมไว้ ดังนั้นชุดนี้ยังไม่ใช่การย้ายระบบทั้งหมดไป MySQL แบบ Production

ก่อนเปิด Marketplace เต็มรูปแบบควรทำต่อ:
1. เปลี่ยน `x-reuni-email` development bridge เป็น server-side authentication/session
2. ย้าย users/products/orders จาก localStorage ไป MySQL API
3. เชื่อมขั้นตอนซื้อสินค้าเข้ากับ Payment Gateway โดยตรง
4. เพิ่ม webhook idempotency/reconciliation และตรวจสอบสถานะรายการ
5. เพิ่ม Seller Payout ใน Phase 2

ใน Phase 1 นี้ callback ของ Payment Gateway ถูกทำให้ idempotent และกรณีโปรโมตชำระไม่สำเร็จจะคืนเครดิต Premium ที่ถูกกันไว้กลับให้ผู้ใช้หนึ่งครั้ง

## ขั้นตอนถัดไป: เตรียม MySQL สำหรับทดสอบจริงในเครื่อง
หากมี Docker Desktop สามารถเริ่ม MySQL ได้โดย:

```bash
docker compose up -d mysql
npm install
copy .env.docker.example .env
npm run check-db
npm start
```

ถ้า `npm run check-db` แสดงตาราง `users`, `products`, `orders`, `payments`, `premium_subscriptions`, `promotions`, `payment_events` แปลว่า MySQL พร้อมแล้ว

> หมายเหตุ: ขั้นนี้ยังไม่ทำให้รับเงินจริง และยังไม่ต้องใส่เลขบัญชีธนาคารผู้ขาย
