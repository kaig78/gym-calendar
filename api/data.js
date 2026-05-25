// Vercel serverless function — Notion proxy for gym-calendar
// Env vars needed: NOTION_TOKEN, NOTION_PAGE_ID
//
// Setup: create a Notion page, add one Code block with content `{}`.
// Get the page ID from the URL: notion.so/Your-Page-Title-<PAGE_ID>
// Strip dashes from the ID and set as NOTION_PAGE_ID.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token  = process.env.NOTION_SECRET;
  const pageId = process.env.NOTION_PAGE_ID;

  // Graceful degradation: if not configured, return empty state
  if (!token || !pageId) {
    if (req.method === 'GET') return res.status(200).json({});
    return res.status(200).json({ ok: true });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  try {
    // Fetch page children to find the Code block
    const childrenRes = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      { headers }
    );
    const childrenData = await childrenRes.json();
    const codeBlock = childrenData.results?.find(b => b.type === 'code');

    if (req.method === 'GET') {
      if (!codeBlock) return res.status(200).json({});
      // Join all rich_text chunks (Notion limits each to 2000 chars)
      const text = (codeBlock.code.rich_text || []).map(t => t.plain_text || '').join('');
      try { return res.status(200).json(JSON.parse(text || '{}')); }
      catch { return res.status(200).json({}); }
    }

    if (req.method === 'POST') {
      const json = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      // Split into 1990-char chunks to stay under Notion's 2000 char limit per text object
      const chunks = [];
      for (let i = 0; i < json.length; i += 1990) {
        chunks.push({ type: 'text', text: { content: json.slice(i, i + 1990) } });
      }

      if (codeBlock) {
        await fetch(`https://api.notion.com/v1/blocks/${codeBlock.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ code: { rich_text: chunks, language: 'json' } }),
        });
      } else {
        await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            children: [{ object: 'block', type: 'code',
              code: { rich_text: chunks, language: 'json' } }],
          }),
        });
      }
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Notion error:', err);
    // Don't break the UI — return empty/ok
    if (req.method === 'GET') return res.status(200).json({});
    return res.status(200).json({ ok: true });
  }
};
