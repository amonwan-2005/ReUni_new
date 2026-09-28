CREATE DATABASE IF NOT EXISTS reuni_new CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE reuni_new;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  premium_until DATETIME NULL,
  promo_credit DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED PRIMARY KEY,
  seller_email VARCHAR(190) NOT NULL,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'approved',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_products_seller (seller_email)
);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(50) NOT NULL UNIQUE,
  product_id BIGINT UNSIGNED NOT NULL,
  buyer_email VARCHAR(190) NOT NULL,
  seller_email VARCHAR(190) NOT NULL,
  gross_amount DECIMAL(10,2) NOT NULL,
  fee_rate DECIMAL(5,2) NOT NULL DEFAULT 3.00,
  platform_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  fee_cap DECIMAL(10,2) NOT NULL DEFAULT 20,
  seller_net DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  settlement_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_buyer (buyer_email),
  INDEX idx_orders_seller (seller_email),
  INDEX idx_orders_payment (payment_status)
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL UNIQUE,
  user_email VARCHAR(190) NOT NULL,
  payment_type VARCHAR(30) NOT NULL,
  reference_id VARCHAR(100) NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'THB',
  provider VARCHAR(40) NOT NULL DEFAULT '2C2P',
  provider_token TEXT NULL,
  provider_transaction_ref VARCHAR(100) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  raw_response JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_payments_user (user_email),
  INDEX idx_payments_status (status),
  INDEX idx_payments_type (payment_type)
);

CREATE TABLE IF NOT EXISTS premium_subscriptions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_email VARCHAR(190) NOT NULL,
  payment_id BIGINT UNSIGNED NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 49,
  promo_credit DECIMAL(10,2) NOT NULL DEFAULT 30,
  starts_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_premium_payment (payment_id),
  INDEX idx_premium_user (user_email)
);

CREATE TABLE IF NOT EXISTS promotions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_email VARCHAR(190) NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  days INT NOT NULL,
  package_price DECIMAL(10,2) NOT NULL,
  credit_used DECIMAL(10,2) NOT NULL DEFAULT 0,
  cash_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_id BIGINT UNSIGNED NULL,
  starts_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_promotions_user (user_email),
  INDEX idx_promotions_product (product_id)
);

CREATE TABLE IF NOT EXISTS payment_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  resp_code VARCHAR(20) NULL,
  resp_desc VARCHAR(255) NULL,
  payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payment_events_invoice (invoice_no)
);
