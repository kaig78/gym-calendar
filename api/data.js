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

  const token  = process.env.NOTION_TOKEN || process.env.NOTION_SECRET;
  let pageId = process.env.NOTION_PAGE_ID;

  // Robust Page ID extraction: handle full URLs or dashed IDs
  if (pageId && pageId.includes('notion.so/')) {
    const parts = pageId.split('/');
    pageId = parts[parts.length - 1].split('?')[0].split('-').pop();
  } else if (pageId) {
    pageId = pageId.replace(/-/g, '');
  }

  // Graceful degradation: if not configured, return empty state with config flag
  if (!token || !pageId) {
    console.warn('Notion not configured: NOTION_TOKEN/SECRET or NOTION_PAGE_ID missing.');
    if (req.method === 'GET') return res.status(200).json({ _config: { notion: false } });
    return res.status(200).json({ ok: true, _config: { notion: false } });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  try {
    // Check if fetch is available (Node 18+)
    if (typeof fetch === 'undefined') {
      throw new Error('fetch is not defined. Please use Node.js 18 or higher.');
    }

    // Fetch page children to find the Code block
    const childrenRes = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      { headers }
    );
    
    if (!childrenRes.ok) {
      const errText = await childrenRes.text();
      throw new Error(`Notion API error (${childrenRes.status}): ${errText}`);
    }

    const childrenData = await childrenRes.json();
    const codeBlock = childrenData.results?.find(b => b.type === 'code');

    if (req.method === 'GET') {
      let data = { _config: { notion: true } };
      if (codeBlock) {
        // Join all rich_text chunks (Notion limits each to 2000 chars)
        const text = (codeBlock.code.rich_text || []).map(t => t.plain_text || '').join('');
        try { 
          const parsed = JSON.parse(text || '{}');
          data = { ...data, ...parsed };
        } catch (e) {
          console.error('Failed to parse JSON from Notion code block:', e);
        }
      }
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      // Ensure we have a string body
      let bodyString = '';
      if (typeof req.body === 'string') {
        bodyString = req.body;
      } else if (req.body && typeof req.body === 'object') {
        bodyString = JSON.stringify(req.body);
      } else {
        // Fallback for unparsed bodies (though Vercel usually parses)
        bodyString = await new Promise((resolve) => {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => { resolve(body); });
        });
      }

      if (!bodyString) {
        return res.status(400).json({ error: 'Empty body' });
      }

      // Split into 1990-char chunks to stay under Notion's 2000 char limit per text object
      const chunks = [];
      for (let i = 0; i < bodyString.length; i += 1990) {
        chunks.push({ type: 'text', text: { content: bodyString.slice(i, i + 1990) } });
      }

      if (codeBlock) {
        const updateRes = await fetch(`https://api.notion.com/v1/blocks/${codeBlock.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ code: { rich_text: chunks, language: 'json' } }),
        });
        if (!updateRes.ok) {
          const errText = await updateRes.text();
          throw new Error(`Failed to update code block: ${errText}`);
        }
      } else {
        const appendRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            children: [{ object: 'block', type: 'code',
              code: { rich_text: chunks, language: 'json' } }],
          }),
        });
        if (!appendRes.ok) {
          const errText = await appendRes.text();
          throw new Error(`Failed to create code block: ${errText}`);
        }
      }
      return res.status(200).json({ ok: true, _config: { notion: true } });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Notion error:', err.message);
    // Don't break the UI completely, but report the error
    return res.status(200).json({ 
      ok: false, 
      error: err.message,
      _config: { notion: !!token && !!pageId } 
    });
  }
};
