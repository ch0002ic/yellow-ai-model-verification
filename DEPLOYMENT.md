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

# Security (use your own private key for production)
PRIVATE_KEY=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
VERIFICATION_SIGNATURE_KEY=hackathon_2025_verification_key

# Rate Limiting
API_RATE_LIMIT_REQUESTS=1000
API_RATE_LIMIT_WINDOW_MS=900000
```

### 📦 Deployment Steps

1. **Connect GitHub Repository**:
   - Repository: `https://github.com/ch0002ic/yellow-ai-model-verification`
   - Branch: `main`
   - Root Directory: `/` (use the entire repository)

2. **Configure Build Settings**:
   - Framework Preset: `Other`
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

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