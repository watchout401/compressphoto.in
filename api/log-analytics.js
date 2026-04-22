/**
 * Vercel Serverless Function: /api/log-analytics
 * Fire-and-forget analytics logging — which exams are most selected
 * Writes to a simple JSON log (or Firestore if configured)
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  const { exam, category } = req.body || {};
  if (!exam) return res.status(400).json({ ok: false });

  // Log to console (Vercel captures these in function logs)
  console.log(JSON.stringify({
    type:      'exam_selection',
    exam,
    category,
    ts:        new Date().toISOString(),
  }));

  // TODO: If Firestore is configured, write here:
  // const firestoreKey = process.env.FIREBASE_SERVICE_ACCOUNT;
  // if (firestoreKey) { ... }

  return res.status(200).json({ ok: true });
}
