<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">

  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/">
    <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="/rss/channel/title"/></title>
        <style>
          body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background: #0b0d12; color: #e8edf6; }
          a { color: #71f7a1; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
          .card { background: rgba(20,23,30,0.92); border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; padding: 18px; }
          h1 { margin: 0 0 8px; font-size: 24px; }
          .meta { color: rgba(232,237,246,0.70); font-size: 14px; margin-bottom: 10px; }
          .desc { color: rgba(232,237,246,0.92); line-height: 1.55; }
          .items { margin-top: 18px; display: grid; gap: 12px; }
          .item { padding: 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.10); background: rgba(13,16,22,0.55); }
          .itemTitle { font-weight: 650; margin-bottom: 4px; }
          .itemMeta { color: rgba(232,237,246,0.70); font-size: 13px; display: flex; gap: 10px; flex-wrap: wrap; }
          .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h1><xsl:value-of select="/rss/channel/title"/></h1>
            <div class="meta">
              <xsl:if test="/rss/channel/link">
                <span class="pill"><a><xsl:attribute name="href"><xsl:value-of select="/rss/channel/link"/></xsl:attribute>Website</a></span>
              </xsl:if>
              <xsl:if test="/rss/channel/language">
                <span class="pill">Lang: <xsl:value-of select="/rss/channel/language"/></span>
              </xsl:if>
              <xsl:if test="/rss/channel/lastBuildDate">
                <span class="pill">Updated: <xsl:value-of select="/rss/channel/lastBuildDate"/></span>
              </xsl:if>
            </div>
            <div class="desc">
              <xsl:value-of select="/rss/channel/description" disable-output-escaping="yes"/>
            </div>
          </div>

          <div class="items">
            <xsl:for-each select="/rss/channel/item">
              <div class="item">
                <div class="itemTitle">
                  <xsl:choose>
                    <xsl:when test="link">
                      <a>
                        <xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute>
                        <xsl:value-of select="title"/>
                      </a>
                    </xsl:when>
                    <xsl:otherwise>
                      <xsl:value-of select="title"/>
                    </xsl:otherwise>
                  </xsl:choose>
                </div>
                <div class="itemMeta">
                  <xsl:if test="pubDate"><span class="pill"><xsl:value-of select="pubDate"/></span></xsl:if>
                  <xsl:if test="guid"><span class="pill">GUID: <xsl:value-of select="guid"/></span></xsl:if>
                  <xsl:if test="enclosure/@url"><span class="pill"><a><xsl:attribute name="href"><xsl:value-of select="enclosure/@url"/></xsl:attribute>Enclosure</a></span></xsl:if>
                </div>
              </div>
            </xsl:for-each>
          </div>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
