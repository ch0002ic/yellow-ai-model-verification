import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.json({
    status: 'healthy',
    network: {
      status: 'connected',
      yellowNetwork: true,
      timestamp: new Date().toISOString()
    }
  });
}