<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="/rss/channel/title"/> — RSS Feed</title>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&amp;display=swap" rel="stylesheet"/>
        <style>
          * { box-sizing: border-box; }
          body { font-family: 'DM Sans', system-ui, sans-serif; margin: 0; background: #0c0e12; color: #e8eaef; font-size: 15px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
          a { color: #00d4aa; text-decoration: none; }
          a:hover { text-decoration: underline; opacity: 0.9; }
          .wrap { max-width: 720px; margin: 0 auto; padding: 24px; }
          .card { background: #14171e; border: 1px solid #2a2f3d; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 6px 24px rgba(0,0,0,0.35); }
          .feed-title { margin: 0 0 10px; font-size: 1.35rem; font-weight: 700; color: #e8eaef; }
          .feed-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; color: #8b92a3; font-size: 13px; margin-bottom: 8px; }
          .feed-desc { color: #e8eaef; line-height: 1.55; font-size: 14px; }
          .items { margin: 0; padding: 0; list-style: none; }
          .item { background: #1a1e28; border: 1px solid #2a2f3d; border-radius: 8px; padding: 14px 18px; margin-bottom: 10px; }
          .item-title { font-weight: 600; font-size: 14px; margin-bottom: 6px; }
          .item-title a { color: #00d4aa; }
          .item-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; color: #8b92a3; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h1 class="feed-title"><xsl:value-of select="/rss/channel/title"/></h1>
            <div class="feed-meta">
              <xsl:if test="/rss/channel/link">
                <a><xsl:attribute name="href"><xsl:value-of select="/rss/channel/link"/></xsl:attribute>Website</a>
              </xsl:if>
              <xsl:if test="/rss/channel/language">
                <span><xsl:value-of select="/rss/channel/language"/></span>
              </xsl:if>
              <xsl:if test="/rss/channel/lastBuildDate">
                <span><xsl:value-of select="/rss/channel/lastBuildDate"/></span>
              </xsl:if>
            </div>
            <xsl:if test="/rss/channel/description and normalize-space(/rss/channel/description)">
              <div class="feed-desc"><xsl:value-of select="/rss/channel/description" disable-output-escaping="yes"/></div>
            </xsl:if>
          </div>

          <ul class="items">
            <xsl:for-each select="/rss/channel/item">
              <li class="item">
                <div class="item-title">
                  <xsl:choose>
                    <xsl:when test="link">
                      <a><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a>
                    </xsl:when>
                    <xsl:otherwise><xsl:value-of select="title"/></xsl:otherwise>
                  </xsl:choose>
                </div>
                <div class="item-meta">
                  <xsl:if test="pubDate"><span><xsl:value-of select="pubDate"/></span></xsl:if>
                  <xsl:if test="enclosure/@url">
                    <a><xsl:attribute name="href"><xsl:value-of select="enclosure/@url"/></xsl:attribute>Enclosure</a>
                  </xsl:if>
                </div>
              </li>
            </xsl:for-each>
          </ul>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
