<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  exclude-result-prefixes="itunes podcast atom">

  <!-- Render as HTML so browsers can display the feed nicely -->
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:strip-space elements="*"/>

  <!-- Helpers -->
  <xsl:template name="text-or-dash">
    <xsl:param name="node"/>
    <xsl:choose>
      <xsl:when test="$node and normalize-space(string($node))">
        <xsl:value-of select="$node"/>
      </xsl:when>
      <xsl:otherwise>-</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="link-or-dash">
    <xsl:param name="url"/>
    <xsl:choose>
      <xsl:when test="$url and normalize-space(string($url))">
        <a href="{$url}"><xsl:value-of select="$url"/></a>
      </xsl:when>
      <xsl:otherwise>-</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="row">
    <xsl:param name="label"/>
    <xsl:param name="content"/>
    <div class="row">
      <span class="label"><xsl:value-of select="$label"/></span>
      <span class="value"><xsl:copy-of select="$content"/></span>
    </div>
  </xsl:template>

  <xsl:template name="badge">
    <xsl:param name="text"/>
    <span class="badge"><xsl:value-of select="$text"/></span>
  </xsl:template>

  <xsl:template name="truncate">
    <xsl:param name="s"/>
    <xsl:param name="n" select="220"/>
    <xsl:choose>
      <xsl:when test="string-length(normalize-space($s)) &gt; $n">
        <xsl:value-of select="concat(substring(normalize-space($s), 1, $n), '…')"/>
      </xsl:when>
      <xsl:otherwise>
        <xsl:value-of select="normalize-space($s)"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- Root -->
  <xsl:template match="/">

    <!-- Common nodes -->
    <xsl:variable name="channel" select="/rss/channel"/>
    <xsl:variable name="feedTitle" select="$channel/title"/>
    <xsl:variable name="feedLink" select="$channel/link"/>
    <xsl:variable name="feedDesc" select="$channel/description"/>
    <xsl:variable name="feedImgItunes" select="$channel/itunes:image/@href"/>
    <xsl:variable name="feedImgRss" select="$channel/image/url"/>

    <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>
          <xsl:choose>
            <xsl:when test="normalize-space($feedTitle)"><xsl:value-of select="$feedTitle"/></xsl:when>
            <xsl:otherwise>RSS Feed</xsl:otherwise>
          </xsl:choose>
        </title>

        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&amp;family=JetBrains+Mono:wght@400&amp;display=swap" rel="stylesheet"/>

        <style>
          :root{
            --bg:#0c0e12;
            --panel:#14171e;
            --panel2:#1a1e28;
            --border:#2a2f3d;
            --text:#e8eaef;
            --muted:#a8aeb8;
            --faint:#8b92a3;
            --accent:#00d4aa;
            --shadow:0 6px 24px rgba(0,0,0,0.35);
            --radius:10px;
          }
          *{box-sizing:border-box}
          body{
            margin:0;
            background:var(--bg);
            color:var(--text);
            font:15px/1.5 'DM Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
            -webkit-font-smoothing:antialiased;
            text-rendering:optimizeLegibility;
          }
          a{color:var(--accent);text-decoration:none;word-break:break-all}
          a:hover{text-decoration:underline;opacity:.9}
          .wrap{max-width:980px;margin:0 auto;padding:24px}
          .card{
            background:var(--panel);
            border:1px solid var(--border);
            border-radius:var(--radius);
            padding:20px;
            margin-bottom:18px;
            box-shadow:var(--shadow);
          }
          .header{
            display:flex;
            gap:16px;
            align-items:flex-start;
            justify-content:space-between;
            flex-wrap:wrap;
          }
          .title{
            margin:0;
            font-size:1.6rem;
            line-height:1.2;
            font-weight:800;
            letter-spacing:-0.01em;
          }
          .subline{
            margin-top:8px;
            color:var(--muted);
            font-size:13px;
          }
          .art{
            display:flex;
            flex-direction:column;
            align-items:center;
            gap:8px;
          }
          .art img{
            width:220px;
            max-width:100%;
            height:auto;
            border-radius:12px;
            border:1px solid var(--border);
            background:#0b0d11;
          }
          .toolbar{
            margin-top:14px;
            display:flex;
            gap:8px;
            flex-wrap:wrap;
          }
          .chip{
            display:inline-flex;
            align-items:center;
            gap:8px;
            padding:7px 10px;
            border:1px solid var(--border);
            background:rgba(255,255,255,0.02);
            border-radius:999px;
            color:var(--muted);
            font-size:12px;
          }
          .chip b{color:var(--text);font-weight:700}
          .section-title{
            margin:18px 0 10px;
            font-size:.95rem;
            font-weight:700;
            color:var(--faint);
            text-transform:uppercase;
            letter-spacing:.06em;
          }
          .grid{
            display:grid;
            grid-template-columns:1fr;
            gap:10px;
          }
          .rows{
            display:grid;
            gap:8px;
          }
          .row{
            display:grid;
            grid-template-columns:190px 1fr;
            gap:12px;
            align-items:start;
            font-size:14px;
          }
          .label{
            color:var(--faint);
            font:12px/1.35 'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
          }
          .value{color:var(--text);word-break:break-word}
          .badge{
            display:inline-block;
            margin-left:6px;
            margin-bottom:4px;
            padding:2px 8px;
            border-radius:999px;
            border:1px solid var(--border);
            background:rgba(255,255,255,0.02);
            color:var(--faint);
            font-size:11px;
            font-weight:700;
            vertical-align:middle;
          }
          .desc{
            margin-top:10px;
            color:var(--muted);
            font-size:14px;
            line-height:1.55;
            white-space:pre-wrap;
          }
          .items{
            list-style:none;
            margin:0;
            padding:0;
            display:grid;
            gap:12px;
          }
          .item{
            background:var(--panel2);
            border:1px solid var(--border);
            border-radius:var(--radius);
            padding:18px;
          }
          .item-head{
            display:flex;
            justify-content:space-between;
            align-items:flex-start;
            gap:12px;
            flex-wrap:wrap;
          }
          .item-title{
            margin:0;
            font-size:1.05rem;
            font-weight:750;
            line-height:1.25;
          }
          .item-meta{
            display:flex;
            gap:8px;
            flex-wrap:wrap;
            justify-content:flex-end;
          }
          .item-desc{
            margin-top:10px;
            color:var(--muted);
            font-size:13px;
            line-height:1.5;
            white-space:pre-wrap;
            border-top:1px dashed rgba(255,255,255,0.08);
            padding-top:10px;
          }
          details{
            margin-top:12px;
            border-top:1px solid rgba(255,255,255,0.06);
            padding-top:12px;
          }
          summary{
            cursor:pointer;
            color:var(--faint);
            font-weight:700;
            user-select:none;
          }
          .mono{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;color:var(--faint)}
          @media (max-width: 720px){
            .row{grid-template-columns:1fr}
          }
        </style>
      </head>

      <body>
        <div class="wrap">

          <!-- Channel card -->
          <div class="card">
            <div class="header">
              <div style="min-width: 280px; flex: 1 1 420px;">
                <h1 class="title">
                  <xsl:call-template name="text-or-dash">
                    <xsl:with-param name="node" select="$feedTitle"/>
                  </xsl:call-template>
                </h1>

                <div class="subline">
                  <xsl:text>Feed preview</xsl:text>
                  <xsl:if test="normalize-space($channel/language)">
                    <xsl:text> • </xsl:text>
                    <span class="mono"><xsl:value-of select="$channel/language"/></span>
                  </xsl:if>
                  <xsl:if test="normalize-space($channel/lastBuildDate)">
                    <xsl:text> • </xsl:text>
                    <span class="mono"><xsl:value-of select="$channel/lastBuildDate"/></span>
                  </xsl:if>
                </div>

                <xsl:if test="normalize-space($feedDesc)">
                  <div class="desc">
                    <xsl:value-of select="$feedDesc"/>
                  </div>
                </xsl:if>

                <div class="toolbar">
                  <span class="chip"><b>Items</b> <xsl:value-of select="count($channel/item)"/></span>
                  <xsl:if test="normalize-space($channel/generator)">
                    <span class="chip"><b>Generator</b> <xsl:value-of select="$channel/generator"/></span>
                  </xsl:if>
                  <xsl:if test="normalize-space($channel/itunes:explicit)">
                    <span class="chip"><b>Explicit</b> <xsl:value-of select="$channel/itunes:explicit"/></span>
                  </xsl:if>
                  <xsl:if test="normalize-space($channel/itunes:type)">
                    <span class="chip"><b>Type</b> <xsl:value-of select="$channel/itunes:type"/></span>
                  </xsl:if>
                  <xsl:if test="normalize-space($channel/podcast:locked)">
                    <span class="chip"><b>Locked</b> <xsl:value-of select="$channel/podcast:locked"/></span>
                  </xsl:if>
                </div>
              </div>

              <xsl:if test="normalize-space($feedImgItunes) or normalize-space($feedImgRss)">
                <div class="art">
                  <xsl:choose>
                    <xsl:when test="normalize-space($feedImgItunes)">
                      <img src="{$feedImgItunes}" alt="Podcast artwork"/>
                    </xsl:when>
                    <xsl:when test="normalize-space($feedImgRss)">
                      <img src="{$feedImgRss}" alt="Feed image"/>
                    </xsl:when>
                  </xsl:choose>

                  <div class="mono">
                    <xsl:text>Artwork: </xsl:text>
                    <xsl:choose>
                      <xsl:when test="normalize-space($feedImgItunes)">
                        <a href="{$feedImgItunes}"><xsl:value-of select="$feedImgItunes"/></a>
                      </xsl:when>
                      <xsl:otherwise>
                        <a href="{$feedImgRss}"><xsl:value-of select="$feedImgRss"/></a>
                      </xsl:otherwise>
                    </xsl:choose>
                  </div>
                </div>
              </xsl:if>
            </div>

            <div class="section-title">Channel</div>
            <div class="rows">

              <xsl:call-template name="row">
                <xsl:with-param name="label" select="'link'"/>
                <xsl:with-param name="content">
                  <xsl:choose>
                    <xsl:when test="normalize-space($feedLink)">
                      <a href="{$feedLink}"><xsl:value-of select="$feedLink"/></a>
                    </xsl:when>
                    <xsl:otherwise>-</xsl:otherwise>
                  </xsl:choose>
                </xsl:with-param>
              </xsl:call-template>

              <xsl:if test="normalize-space($channel/copyright)">
                <xsl:call-template name="row">
                  <xsl:with-param name="label" select="'copyright'"/>
                  <xsl:with-param name="content"><xsl:value-of select="$channel/copyright"/></xsl:with-param>
                </xsl:call-template>
              </xsl:if>

              <xsl:if test="normalize-space($channel/itunes:author)">
                <xsl:call-template name="row">
                  <xsl:with-param name="label" select="'itunes:author'"/>
                  <xsl:with-param name="content"><xsl:value-of select="$channel/itunes:author"/></xsl:with-param>
                </xsl:call-template>
              </xsl:if>

              <xsl:if test="normalize-space($channel/itunes:owner/itunes:name) or normalize-space($channel/itunes:owner/itunes:email)">
                <xsl:call-template name="row">
                  <xsl:with-param name="label" select="'itunes:owner'"/>
                  <xsl:with-param name="content">
                    <xsl:choose>
                      <xsl:when test="normalize-space($channel/itunes:owner/itunes:name)">
                        <xsl:value-of select="$channel/itunes:owner/itunes:name"/>
                      </xsl:when>
                      <xsl:otherwise>-</xsl:otherwise>
                    </xsl:choose>
                    <xsl:if test="normalize-space($channel/itunes:owner/itunes:email)">
                      <xsl:text> </xsl:text>
                      <span class="badge"><xsl:value-of select="$channel/itunes:owner/itunes:email"/></span>
                    </xsl:if>
                  </xsl:with-param>
                </xsl:call-template>
              </xsl:if>

              <xsl:if test="normalize-space($channel/podcast:guid)">
                <xsl:call-template name="row">
                  <xsl:with-param name="label" select="'podcast:guid'"/>
                  <xsl:with-param name="content"><xsl:value-of select="$channel/podcast:guid"/></xsl:with-param>
                </xsl:call-template>
              </xsl:if>

              <xsl:if test="normalize-space($channel/podcast:license)">
                <xsl:call-template name="row">
                  <xsl:with-param name="label" select="'podcast:license'"/>
                  <xsl:with-param name="content"><xsl:value-of select="$channel/podcast:license"/></xsl:with-param>
                </xsl:call-template>
              </xsl:if>

              <xsl:if test="normalize-space($channel/podcast:medium)">
                <xsl:call-template name="row">
                  <xsl:with-param name="label" select="'podcast:medium'"/>
                  <xsl:with-param name="content"><xsl:value-of select="$channel/podcast:medium"/></xsl:with-param>
                </xsl:call-template>
              </xsl:if>

              <!-- Categories -->
              <xsl:if test="$channel/itunes:category">
                <xsl:for-each select="$channel/itunes:category">
                  <xsl:variable name="cat1" select="@text"/>
                  <xsl:variable name="cat2" select="itunes:category/@text"/>
                  <xsl:call-template name="row">
                    <xsl:with-param name="label" select="'itunes:category'"/>
                    <xsl:with-param name="content">
                      <xsl:value-of select="$cat1"/>
                      <xsl:if test="normalize-space($cat2)">
                        <xsl:text> → </xsl:text>
                        <xsl:value-of select="$cat2"/>
                      </xsl:if>
                    </xsl:with-param>
                  </xsl:call-template>
                </xsl:for-each>
              </xsl:if>

              <!-- atom:link -->
              <xsl:if test="$channel/atom:link">
                <xsl:for-each select="$channel/atom:link">
                  <xsl:call-template name="row">
                    <xsl:with-param name="label" select="concat('atom:link', ' (', @rel, ')')"/>
                    <xsl:with-param name="content">
                      <a href="{@href}"><xsl:value-of select="@href"/></a>
                      <xsl:if test="@type">
                        <xsl:call-template name="badge">
                          <xsl:with-param name="text" select="concat('type: ', @type)"/>
                        </xsl:call-template>
                      </xsl:if>
                    </xsl:with-param>
                  </xsl:call-template>
                </xsl:for-each>
              </xsl:if>

            </div>
          </div>

          <!-- Items list -->
          <div class="card">
            <div class="section-title">Episodes</div>

            <ul class="items">
              <xsl:for-each select="$channel/item">
                <!-- Sort by pubDate text (best-effort in XSLT 1.0); keeps original order if empty -->
                <xsl:sort select="pubDate" data-type="text" order="descending"/>

                <li class="item">
                  <div class="item-head">
                    <div>
                      <h3 class="item-title">
                        <xsl:choose>
                          <xsl:when test="normalize-space(link)">
                            <a href="{link}"><xsl:value-of select="title"/></a>
                          </xsl:when>
                          <xsl:otherwise><xsl:value-of select="title"/></xsl:otherwise>
                        </xsl:choose>
                      </h3>

                      <div class="item-meta">
                        <xsl:if test="normalize-space(pubDate)">
                          <span class="chip"><b>Date</b> <xsl:value-of select="pubDate"/></span>
                        </xsl:if>

                        <xsl:if test="normalize-space(itunes:duration)">
                          <span class="chip"><b>Duration</b> <xsl:value-of select="itunes:duration"/></span>
                        </xsl:if>

                        <xsl:if test="normalize-space(itunes:episodeType)">
                          <span class="chip"><b>Type</b> <xsl:value-of select="itunes:episodeType"/></span>
                        </xsl:if>

                        <xsl:if test="normalize-space(itunes:season)">
                          <span class="chip"><b>Season</b> <xsl:value-of select="itunes:season"/></span>
                        </xsl:if>

                        <xsl:if test="normalize-space(itunes:episode)">
                          <span class="chip"><b>Episode</b> <xsl:value-of select="itunes:episode"/></span>
                        </xsl:if>

                        <xsl:if test="normalize-space(itunes:explicit)">
                          <span class="chip"><b>Explicit</b> <xsl:value-of select="itunes:explicit"/></span>
                        </xsl:if>
                      </div>
                    </div>
                  </div>

                  <div class="rows" style="margin-top:12px;">
                    <xsl:call-template name="row">
                      <xsl:with-param name="label" select="'link'"/>
                      <xsl:with-param name="content">
                        <xsl:choose>
                          <xsl:when test="normalize-space(link)">
                            <a href="{link}"><xsl:value-of select="link"/></a>
                          </xsl:when>
                          <xsl:otherwise>-</xsl:otherwise>
                        </xsl:choose>
                      </xsl:with-param>
                    </xsl:call-template>

                    <xsl:if test="normalize-space(guid)">
                      <xsl:call-template name="row">
                        <xsl:with-param name="label" select="'guid'"/>
                        <xsl:with-param name="content">
                          <span class="mono"><xsl:value-of select="guid"/></span>
                          <xsl:if test="guid/@isPermaLink">
                            <xsl:call-template name="badge">
                              <xsl:with-param name="text" select="concat('isPermaLink: ', guid/@isPermaLink)"/>
                            </xsl:call-template>
                          </xsl:if>
                        </xsl:with-param>
                      </xsl:call-template>
                    </xsl:if>

                    <xsl:if test="enclosure/@url">
                      <xsl:call-template name="row">
                        <xsl:with-param name="label" select="'enclosure'"/>
                        <xsl:with-param name="content">
                          <a href="{enclosure/@url}"><xsl:value-of select="enclosure/@url"/></a>
                          <xsl:if test="enclosure/@type">
                            <xsl:call-template name="badge">
                              <xsl:with-param name="text" select="concat('type: ', enclosure/@type)"/>
                            </xsl:call-template>
                          </xsl:if>
                          <xsl:if test="enclosure/@length">
                            <xsl:call-template name="badge">
                              <xsl:with-param name="text" select="concat('length: ', enclosure/@length)"/>
                            </xsl:call-template>
                          </xsl:if>
                        </xsl:with-param>
                      </xsl:call-template>
                    </xsl:if>

                    <xsl:if test="itunes:image/@href">
                      <xsl:call-template name="row">
                        <xsl:with-param name="label" select="'itunes:image'"/>
                        <xsl:with-param name="content">
                          <a href="{itunes:image/@href}"><xsl:value-of select="itunes:image/@href"/></a>
                        </xsl:with-param>
                      </xsl:call-template>
                    </xsl:if>

                    <xsl:for-each select="podcast:transcript">
                      <xsl:call-template name="row">
                        <xsl:with-param name="label" select="'podcast:transcript'"/>
                        <xsl:with-param name="content">
                          <a href="{@url}"><xsl:value-of select="@url"/></a>
                          <xsl:if test="@type">
                            <xsl:call-template name="badge">
                              <xsl:with-param name="text" select="@type"/>
                            </xsl:call-template>
                          </xsl:if>
                        </xsl:with-param>
                      </xsl:call-template>
                    </xsl:for-each>
                  </div>

                  <!-- Description: show a short preview + expandable full -->
                  <xsl:if test="normalize-space(description)">
                    <div class="item-desc">
                      <xsl:call-template name="truncate">
                        <xsl:with-param name="s" select="description"/>
                        <xsl:with-param name="n" select="260"/>
                      </xsl:call-template>

                      <details>
                        <summary>Show full description</summary>
                        <div class="item-desc" style="border:0;padding-top:10px;margin-top:0;">
                          <xsl:value-of select="description"/>
                        </div>
                      </details>
                    </div>
                  </xsl:if>

                </li>
              </xsl:for-each>
            </ul>

          </div>
        </div>
      </body>
    </html>
  </xsl:template>

</xsl:stylesheet>
