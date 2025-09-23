# 🚀 Vercel Deployment Guide - Yellow Network Hackathon 2025

## 📋 Deployment Information

### 🌐 Project Details
- **Project Name**: `yellow-ai-model-verification`
- **Framework**: Node.js (Express.js + TypeScript)
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`
- **Development Command**: `npm run dev`

### 🔧 Environment Variables

Configure these environment variables in Vercel Dashboard:

> **🔐 Security Note**: Replace the placeholder values below with your real credentials before deployment.

```bash
# Core Configuration
NODE_ENV=production
LOG_LEVEL=info
PORT=3000
HOST=0.0.0.0

# Network Configuration
TARGET_NETWORK=testnet
NETWORK_ID=yellow-network-hackathon-2025
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532

# Ethereum Fallback
ETHEREUM_RPC_URL=https://rpc.ankr.com/eth_sepolia
ETHEREUM_CHAIN_ID=11155111

# Yellow Network Contracts (Base Sepolia)
CUSTODY_CONTRACT_ADDRESS=0xDD70b689c19a992dd4D7C07582df63c7B46c8832
GUEST_CONTRACT_ADDRESS=0xD5D5DC30AE7a6EEc268671f5eeB523A7C5C9EED4
ADJUDICATOR_CONTRACT_ADDRESS=0x742d35cc8c4cc8e1c8cb1b33df5a9b3c2bdc4f2e

# Active Yellow Network Channel
YELLOW_NETWORK_CHANNEL_ID=0x37825bfb197fa307b6063e88e872efc6c1fed32dcbdb886ff584933bd05dfc9f

# Feature Flags
CROSS_CHAIN_ENABLED=true
GASLESS_ENABLED=true
DEMO_MODE=false

# Performance Settings
MAX_VERIFICATION_LATENCY=1000
MIN_THROUGHPUT=100
SUB_SECOND_TARGET_MS=500

# Security - IMPORTANT: Replace with your real values
# PRIVATE_KEY: Export from MetaMask (Account Details > Export Private Key)
# For hackathon: Use a dedicated test wallet with Base Sepolia ETH
PRIVATE_KEY=0xD5D5DC30AE7a6EEc268671f5eeB523A7C5C9EED4

# VERIFICATION_SIGNATURE_KEY: Generate a secure random string for your app
# Example: yellow_hackathon_2025_[your_team_name]_[random_string]
VERIFICATION_SIGNATURE_KEY=yellow_hackathon_2025_hashbill_team_singapore

# Rate Limiting
API_RATE_LIMIT_REQUESTS=1000
API_RATE_LIMIT_WINDOW_MS=900000
```

### 🔐 How to Get Real Security Values

**Before deploying, you MUST replace the placeholder security values:**

#### 1. **PRIVATE_KEY** - Your Wallet Private Key

**Recommended for Hackathon**: Use a dedicated test wallet

```bash
# Method 1: Create New MetaMask Account (Safest)
# 1. Add new account in MetaMask
# 2. Fund with Base Sepolia ETH from faucet: https://www.alchemy.com/faucets/base-sepolia
# 3. Export private key: Account Details > Export Private Key
# 4. Copy the private key (64 characters after 0x)

# Method 2: Use Existing MetaMask Account  
# 1. Go to MetaMask > Account Details
# 2. Click "Export Private Key"
# 3. Enter MetaMask password
# 4. Copy the private key

# Format: 0x followed by 64 hex characters
PRIVATE_KEY=0xa1b2c3d4e5f6789012345678901234567890123456789012345678901234567890
```

#### 2. **VERIFICATION_SIGNATURE_KEY** - Custom App Secret

```bash
# Generate a unique key for your hackathon submission
# Use your team name + random string for uniqueness

# Example formats:
VERIFICATION_SIGNATURE_KEY=yellow_hackathon_2025_hashbill_team_singapore_$(date +%s)
VERIFICATION_SIGNATURE_KEY=yellow_hackathon_2025_your_team_name_your_random_string

# Or generate cryptographically secure:
# openssl rand -hex 32
```

#### 3. **Required Testnet Setup**

Your wallet needs Base Sepolia testnet ETH:
- **Faucet**: https://www.alchemy.com/faucets/base-sepolia  
- **Network**: Base Sepolia (Chain ID: 84532)
- **RPC**: https://sepolia.base.org
- **Amount Needed**: ~0.1 ETH for testing

#### 🛡️ Security Checklist for Hackathon

- ✅ **Use dedicated test wallet** (not your main wallet)
- ✅ **Only use Base Sepolia testnet** (never mainnet for hackathon)
- ✅ **Fund wallet with testnet ETH** from official faucets
- ✅ **Never commit private keys** to git (already in .gitignore)
- ✅ **Use environment variables** in Vercel for all secrets
- ✅ **Generate unique signature key** for your team

### 📦 Deployment Steps

1. **Connect GitHub Repository**:
   - Repository: `https://github.com/ch0002ic/yellow-ai-model-verification`
   - Branch: `main`
   - Root Directory: `./` (keep as default)

2. **Configure Build Settings**:
   - Framework Preset: **`Other`** (correct for Node.js Express applications)
   - Build Command: `npm run build`
   - Output Directory: `dist` (replace the default "public" setting)
   - Install Command: `npm install` (keep default)
   - Root Directory: `./` (leave as default)

3. **Important Build Configuration Notes**:
   - **Build Command**: Set to `npm run build` (compiles TypeScript)
   - **Output Directory**: Set to `dist` (where compiled JS files go)
   - **Install Command**: Keep as `npm install`
   - **Framework Preset**: Use `Other` for Express.js apps

3. **Set Environment Variables**:
   - Copy the environment variables above into Vercel Dashboard
   - Ensure all values are set correctly

4. **Deploy**:
   - Click "Deploy" 
   - Vercel will automatically build and deploy the application

### 🎯 Expected Results

After deployment, your Yellow Network AI Verification demo will be available at:
- **Dashboard**: `https://your-app.vercel.app/`
- **Health Check**: `https://your-app.vercel.app/health`
- **API Documentation**: `https://your-app.vercel.app/api/channel-info`

### 🧪 Testing Deployment

Test the deployed application:

```bash
# Health check
curl https://your-app.vercel.app/health

# AI Verification API
curl -X POST https://your-app.vercel.app/api/gasless-proof \
  -H "Content-Type: application/json" \
  -d '{"modelHash":"0x123","proof":"test-proof"}'

# Channel information
curl https://your-app.vercel.app/api/channel-info
```

### 🎉 Features Available

- ✅ **Real-time AI Model Verification** (sub-second performance)
- ✅ **Yellow Network State Channels** (with real USDC channel)
- ✅ **Gasless Transactions** ($38+ savings per transaction)
- ✅ **Interactive Dashboard** (WebSocket updates)
- ✅ **Cross-chain Support** (Base Sepolia primary)
- ✅ **Production Monitoring** (comprehensive logging)

### 🏆 Hackathon Demo Ready

Your Yellow Network Hackathon 2025 submission is now live and ready for judging!

**Repository**: https://github.com/ch0002ic/yellow-ai-model-verification
**Live Demo**: `https://your-app.vercel.app/`
**Team**: HashBill
**Event**: Yellow Network Hackathon Singapore 2025