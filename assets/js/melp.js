// HTML/Attribute escaping utilities for XSS prevention
const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

const escapeAttr = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
};

// Convert an Elasticsearch highlight fragment (from Corpora's
// `highlight_fields` parameter) into safe display HTML. Fragments come from
// the letters' raw TEI-derived `html` field, so they can start/end mid-tag
// and contain arbitrary markup; only the <em> match markers survive — as
// <strong> — and everything else is stripped and escaped.
const highlightFragmentToHtml = (fragment) => {
    let text = String(fragment)

    // Trim a leading partial tag (text before a '>' that precedes any '<')
    // and a trailing one (a '<' with no closing '>' after it).
    let first_lt = text.indexOf('<')
    let first_gt = text.indexOf('>')
    if (first_gt !== -1 && (first_lt === -1 || first_gt < first_lt)) text = text.slice(first_gt + 1)
    let last_gt = text.lastIndexOf('>')
    let last_lt = text.lastIndexOf('<')
    if (last_lt > last_gt) text = text.slice(0, last_lt)

    // Protect the match markers, strip every other tag, escape, restore.
    const HL_OPEN = '\u0001', HL_CLOSE = '\u0002'
    text = text.replace(/<em>/g, HL_OPEN).replace(/<\/em>/g, HL_CLOSE)
    text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    // Tidy whitespace the tag-stripping leaves behind: spaces trapped just
    // inside the match markers (e.g. "<em>Ireland </em>,") and orphan
    // spaces before punctuation.
    text = text.replace(/\s+(?=\u0002)/g, '').replace(/(\u0001)\s+/g, '$1')
    text = text.replace(/(\u0002?)\s+([,.;:!?])/g, '$1$2')
    // A fragment can end inside a match — balance a dangling open marker.
    if (text.split(HL_OPEN).length > text.split(HL_CLOSE).length) text += HL_CLOSE
    text = escapeHtml(text)
    return text.replaceAll(HL_OPEN, '<strong>').replaceAll(HL_CLOSE, '</strong>')
};

// Accessibility helpers shared by the Nav and AdvancedSearch modal flows.
// Each modal's open method should call A11y.trap(modal_el, return_to_el);
// the matching close method should call A11y.release(modal_el). The trap
// stores the previously-focused element and restores it on release, binds
// an Esc handler that calls the close callback, and constrains Tab to
// cycle within the modal.

const A11y = {
    FOCUSABLE_SELECTOR: 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',

    // Stash per-modal state on the modal element itself so multiple modals
    // can be in flight without colliding.
    trap(modal_el, on_escape) {
        let modal = modal_el instanceof jQuery ? modal_el[0] : modal_el
        if (!modal) return

        let state = {
            return_to: document.activeElement,
            on_escape: on_escape,
            key_handler: null
        }

        state.key_handler = function(e) {
            if (e.key === 'Escape') {
                e.preventDefault()
                if (typeof state.on_escape === 'function') state.on_escape()
                return
            }
            if (e.key !== 'Tab') return

            let focusables = Array.from(modal.querySelectorAll(A11y.FOCUSABLE_SELECTOR))
                .filter(el => el.offsetParent !== null || el === document.activeElement)
            if (!focusables.length) return

            let first = focusables[0]
            let last = focusables[focusables.length - 1]

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first.focus()
            }
        }

        modal.addEventListener('keydown', state.key_handler)
        modal._a11yState = state

        // Move focus into the modal. Prefer an element with a `data-initial-focus`
        // hint; fall back to the first focusable descendant.
        let target = modal.querySelector('[data-initial-focus]')
            || modal.querySelector(A11y.FOCUSABLE_SELECTOR)
        if (target) setTimeout(() => target.focus(), 0)
    },

    release(modal_el) {
        let modal = modal_el instanceof jQuery ? modal_el[0] : modal_el
        if (!modal || !modal._a11yState) return
        let state = modal._a11yState
        modal.removeEventListener('keydown', state.key_handler)
        if (state.return_to && typeof state.return_to.focus === 'function') {
            state.return_to.focus()
        }
        delete modal._a11yState
    }
};

class MELP {
    constructor(corpora_host, corpora_token, melp_corpus_id, plugin_url, iiif_prefix, github_prefix) {
        this.host = corpora_host
        this.token = corpora_token
        this.corpus_id = melp_corpus_id
        this.path = window.location.pathname
        this.params = this.get_request_parameters()
        this.plugin_url = plugin_url
        this.iiif_prefix = iiif_prefix
        this.github_prefix = github_prefix
        this.breakpoints = {
            mobile: 799
        }
        this.medium = this.determine_medium()
        this.resizeTimer = null
        this.nav = null
        this.advanced_search = null
        this.letter_viewer = null
        this.topic_index = null

        // 'this' helper
        let sender = this

        // A11Y: ensure a <main id="main-content"> landmark exists so the
        // global skip link (functions.php :: understrap_child_skip_link)
        // has a target. Must run before any template loads so the move
        // happens against the empty server-side scaffold.
        this.ensure_main_landmark()

        // NAV
        let nav_container = jQuery('#top-container')
        if (nav_container.length) this.load_template(
            nav_container,
            'nav.html',
            function() {
                // Banner visibility is an admin toggle on the Site Text screen.
                if (MELP.text('announcement_show', '1') === '0') {
                    jQuery('#announcement-banner').remove()
                }
                sender.nav = new Nav(sender, nav_container)
                sender.adjust_for_screen_size()
                // Try the footer clone here as well — if footer.html finished
                // loading before nav.html, the existing clone call in the
                // footer-template callback ran when #hamburger-footer-container
                // didn't exist yet and quietly skipped. Doing it from both
                // callbacks (idempotently) guarantees the drawer footer is
                // populated regardless of which template finishes first.
                sender.populate_hamburger_footer()
            }
        )

        // BROWSE BY MENU
        let browse_by_container = jQuery('#browse-by-container')
        if (browse_by_container.length) this.load_template(
            browse_by_container,
            'browse_by.html',
            function() {
                let browser = new Browser(melp)
            }
        )

        // START HERE
        let start_here_container = jQuery('#start-here-container')
        if (start_here_container.length) this.load_template(
                start_here_container,
                'start_here.html',
                function() {
                    jQuery('.letter-carousel').each(function() {
                        let carousel = new LetterCarousel(sender, jQuery(this))
                    })
                }
            )

        // PROJECT UPDATES
        let project_updates_container = jQuery('#project-updates-container')
        if (project_updates_container.length) this.load_template(
            project_updates_container,
            'project_updates.html',
            function() {
                let updates = new ProjectUpdates(sender, jQuery('#project-updates'))

                // Place the editors/team/design byline (3 icon lines) directly
                // under the "Project Updates" heading. Done here rather than in
                // Nav because the <h2> only exists once this template has loaded.
                if (sender.path === '/') {
                    let byline = jQuery('#masthead-byline')
                    let heading = jQuery('#project-updates-container > h2').first()
                    if (byline.length && heading.length) byline.insertAfter(heading)
                }

                // Move pre-rendered Ninja Form into subscribe div
                let formHolder = jQuery('#melp-ninja-form-holder')
                let subscribeDiv = jQuery('#subscribe')
                if (formHolder.length && subscribeDiv.length) {
                    subscribeDiv.append(formHolder.children())
                    formHolder.remove()
                }
            }
        )

        // TOPIC INDEX
        let topic_index_container = jQuery('#topic-index-container')
        if (topic_index_container.length) this.load_template(
            topic_index_container,
            'topic_index.html',
            function() {
                sender.topic_index = new TopicIndex(sender)
                sender.adjust_for_screen_size()
            }
        )

        // LETTER VIEWER AND ADVANCED SEARCH
        let advanced_search_container = jQuery('#advanced-search-container')
        if (advanced_search_container.length) {
            if (this.params.path.length) {
                let letter_id = this.params.path[0].replaceAll('%20', ' ')
                advanced_search_container.addClass('letter-viewer-container')
                // The letter viewer fetches its own template: markup is only
                // injected once the letter data is known, so the layout can
                // be decided before anything is displayed (e.g. letters with
                // no transcription swap the transcript for a placeholder
                // rather than rendering it and emptying it afterwards).
                sender.letter_viewer = new LetterViewer(sender, letter_id, advanced_search_container)
            }
            else {
                this.load_template(
                    advanced_search_container,
                    'advanced_search.html',
                    function () {
                        sender.advanced_search = new AdvancedSearch(sender)
                        sender.adjust_for_screen_size()
                    }
                )
            }
        }

        // BROWSER
        let browse_container = jQuery('#browse-container')
        if (browse_container.length) {

        }

        // FOOTER
        let footer_container = jQuery('#footer-container')
        if (footer_container.length) this.load_template(footer_container, 'footer.html', function() {
            sender.populate_hamburger_footer()
            setTimeout(() => sender.adjust_for_screen_size(), 1000)
        })

        jQuery(window).on('resize', function() {
            clearTimeout(sender.resizeTimer)
            sender.resizeTimer = setTimeout(() => sender.adjust_for_screen_size(), 500)
        })
    }

    /**
     * `true` when the user has the OS-level reduced-motion preference set.
     * JS-driven animations (jQuery `animate()` scroll, the carousel
     * transform fallback) consult this to decide whether to skip easing.
     * CSS-driven transitions are already gated by the
     * `prefers-reduced-motion` block in `_typography.scss`.
     *
     * WCAG 2.3.3 AAA / strong best practice.
     */
    static prefers_reduced_motion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    }

    /**
     * Ensure a `<main id="main-content">` landmark and a skip link exist
     * so keyboard users can bypass the repeated nav. Elementor-built
     * pages (homepage, `/letters/`, single letter pages) bypass
     * `get_header()`/`get_footer()` and don't fire the `wp_body_open`
     * action, so neither the PHP skip link nor any `<main>` lands
     * server-side. `topic-index.php` provides both — detected here as
     * "<main> already in the DOM" / "<a class='skip-link'> already in
     * the DOM" and we no-op for each.
     *
     * The wrap moves every body child between `#top-container`
     * (exclusive) and `#footer-container` (exclusive) into the new
     * `<main>`, so the nav and footer stay as their own landmarks
     * outside `<main>` (standard WAI-ARIA landmark structure).
     *
     * Idempotent: re-running it is a no-op once both pieces exist.
     *
     * WCAG 2.4.1 A (Bypass Blocks), 1.3.1 A (Info and Relationships).
     */
    /**
     * Effective site text for `key` — the value from the admin "Site Text"
     * screen (localized as `melpText` by the melp plugin), or `fallback`
     * when the plugin didn't localize anything.
     */
    static text(key, fallback) {
        if (typeof melpText !== 'undefined' && typeof melpText[key] === 'string' && melpText[key].length) {
            return melpText[key]
        }
        return fallback
    }

    /**
     * Fill admin-editable text into a freshly loaded template part.
     *   [data-melp-text="key"]            → element text (or HTML when the
     *                                       element also has [data-melp-html];
     *                                       those values are wp_kses-sanitized
     *                                       server-side).
     *   [data-melp-text-attr="attr:key"]  → attribute value.
     *   [data-melp-require="key"]         → remove element when key is empty.
     * The inline template text doubles as the fallback when `melpText` is
     * absent, so templates render sensibly even without the plugin.
     */
    static apply_site_text(root) {
        if (typeof melpText === 'undefined') return

        root.find('[data-melp-text]').each(function() {
            let el = jQuery(this)
            let val = melpText[el.data('melp-text')]
            if (typeof val === 'string' && val.length) {
                if (el.is('[data-melp-html]')) el.html(val)
                else el.text(val)
            }
        })

        root.find('[data-melp-text-attr]').each(function() {
            let el = jQuery(this)
            let [attr, key] = String(el.data('melp-text-attr')).split(':')
            let val = melpText[key]
            if (attr && typeof val === 'string' && val.length) el.attr(attr, val)
        })

        root.find('[data-melp-require]').each(function() {
            let el = jQuery(this)
            let val = melpText[el.data('melp-require')]
            if (typeof val !== 'string' || !val.length) el.remove()
        })
    }

    ensure_main_landmark() {
        // Skip link — prepend to <body> as first child if missing so it
        // is the first focusable element on Tab from page load.
        if (!document.querySelector('.skip-link')) {
            let skip = document.createElement('a')
            skip.className = 'skip-link'
            skip.href = '#main-content'
            skip.textContent = 'Skip to main content'
            document.body.insertBefore(skip, document.body.firstChild)
        }

        // <main> wrap — only on pages that don't already provide one.
        if (!document.querySelector('main')) {
            let top = document.getElementById('top-container')
            let foot = document.getElementById('footer-container')
            if (top && foot && top.parentNode === foot.parentNode) {
                let main = document.createElement('main')
                main.id = 'main-content'

                // Move every sibling between top-container and footer-container
                // into the new <main>. nextSibling is captured before append
                // because appendChild detaches the node from its current parent.
                let node = top.nextSibling
                while (node && node !== foot) {
                    let next = node.nextSibling
                    main.appendChild(node)
                    node = next
                }

                foot.parentNode.insertBefore(main, foot)
            }
        }

        // <h1> fallback — Elementor-managed pages (e.g. the homepage) render
        // no h1 of their own, so headings there start at h3. Inject a
        // visually-hidden h1 from the document title; pages whose templates
        // already provide an h1 (letters, topic index, viewer) are untouched.
        if (!document.querySelector('h1')) {
            let main = document.querySelector('main')
            if (main) {
                let h1 = document.createElement('h1')
                h1.className = 'visually-hidden'
                h1.textContent = document.title.split('–').pop().trim() || 'Maria Edgeworth Letters Project'
                main.insertBefore(h1, main.firstChild)
            }
        }
    }

    make_request(path, type, params={}, callback, inject_host=true, spool=false, spool_records=[]) {
        let url = path
        if (inject_host) url = `${this.host}${path}`

        let req = {
            type: type,
            url: url,
            dataType: 'json',
            crossDomain: true,
            data: params,
            success: callback
        }

        if (this.token) {
            let sender = this
            req['beforeSend'] = function(xhr) { xhr.setRequestHeader("Authorization", `Token ${sender.token}`) }
        }

        if (spool) {
            let corpora_instance = this;
            req.success = function(data) {
                if (
                    data.hasOwnProperty('records') &&
                    data.hasOwnProperty('meta') &&
                    data.meta.hasOwnProperty('has_next_page') &&
                    data.meta.hasOwnProperty('page') &&
                    data.meta.hasOwnProperty('page_size') &&
                    data.meta.has_next_page
                ) {
                    let next_params = Object.assign({}, params);
                    next_params.page = data.meta.page + 1;
                    next_params['page-size'] = data.meta.page_size;

                    corpora_instance.make_request(
                        path,
                        type,
                        next_params,
                        callback,
                        inject_host,
                        spool,
                        spool_records.concat(data.records)
                    )
                } else {
                    data.records = spool_records.concat(data.records);
                    callback(data);
                }
            }
        }

        return jQuery.ajax(req)
    }

    random_index(length) {
        return Math.floor(Math.random() * length)
    }

    count_instances(a_string, instance) {
        return a_string.split(instance).length
    }

    inject_iiif_info(img, callback) {
        jQuery.getJSON(`${img.data('iiif-identifier')}/info.json`, {}, function(info) {
            img.data('fullwidth', info.width)
            img.data('fullheight', info.height)
            if (!img.data('region'))
                img.data('region', `${parseInt(info.width / 2) - 100},${parseInt(info.height / 2) - 100},200,200`)
            callback()
        })
    }

    render_image(img, size, region_only=true) {
        let iiif_src
        let width = size
        let height = size

        if (img.data('display-restriction') === 'No Image') {
            iiif_src = `${this.plugin_url}/img/image-unavailable.png`
            if (!region_only) {
                width = 200
                height = 200
            }
        } else {
            if (img.data('display-restriction') === 'Thumbnail Only' && !region_only) {
                region_only = true
                width = 200
                height = 200
            }

            if (region_only) {
                iiif_src = `${img.data('iiif-identifier')}/${img.data('region')}/${size},${size}/0/default.png`
            } else {
                if (width > img.data('fullwidth')) width = img.data('fullwidth')
                iiif_src = `${img.data('iiif-identifier')}/full/${width},/0/default.png`
                let ratio = width / img.data('fullwidth')
                height = parseInt(ratio * img.data('fullheight'))
                img.css('filter', 'brightness(2)')
                img.on('load', function () {
                    img.css('filter', 'brightness(1.1)')
                })
            }
        }

        img.attr('src', iiif_src)
        img.css('width', `${width}px`)
        img.css('height', `${height}px`)
        img.data('loaded', true)
    }
    
    render_metadata(artwork, style='vertical') {
        if (style === 'vertical') {
            return `
              <dl>
                <dt>Year:</dt><dd>${artwork.year}</dd>
                ${artwork.collection && !artwork.anonymize_collector ? `<dt>Collection:</dt><dd>${artwork.collection.label}</dd>` : ''}
                ${artwork.anonymize_collector ? `<dt>Collection:</dt><dd>Private Collection</dd>` : ''}
                <dt>Medium:</dt><dd>${artwork.medium}</dd>
                <dt>Surface:</dt><dd>${artwork.surface}</dd>
                <dt>Size:</dt><dd>${artwork.size_inches}</dd>
              </dl>
              <a class="mt-2" href="/artwork/${artwork.id}/" target="_blank">See more...</a>
            `
        } else if (style === 'horizontal') {
            return `
                <div class="row">
                  <div class="col-md-6">
                    <dl>
                      <dt>Year:</dt><dd>${artwork.year}</dd>
                      <dt>Medium:</dt><dd>${artwork.medium}</dd>
                      <dt>Surface:</dt><dd>${artwork.surface}</dd>
                    </dl>
                  </div>
                  <div class="col-md-6 d-flex flex-column">
                    <dl style="flex: 1;">
                      ${artwork.collection && !artwork.anonymize_collector ? `<dt>Collection:</dt><dd>${artwork.collection.label}</dd>` : ''}
                      ${artwork.anonymize_collector ? `<dt>Collection:</dt><dd>Private Collection</dd>` : ''}
                      <dt>Size:</dt><dd>${artwork.size_inches}</dd>
                    </dl>
                    <div class="w-100">
                      <a class="float-right" href="/artwork/${artwork.id}/" target="_blank">See more...</a>
                    </div>
                  </div>
                </div>
            `
        } else if (style === 'full') {
            let tags = []
            artwork.tags.forEach(tag => {
                let [key, value] = tag.label.split(': ')
                tags.push(`<dt>${key}:</dt><dd>${value}</dd>`)
            })

            let exhibits = []
            artwork.exhibits.forEach(exhibit => {
                exhibits.push(`<p>${exhibit.label}</p>`)
            })

            let prizes = []
            artwork.prizes.forEach(prize => {
                prizes.push(`<p><i>${prize.name}</i> awarded at ${prize.exhibit}</p>`)
            })

            return `
                <dl>
                  ${artwork.caption ? `<dt>Caption:</dt><dd>${artwork.caption}</dd>` : ''}
                  ${artwork.alt_title ? `<dt>Alternate Title</dt><dd>${artwork.alt_title}</dd>` : ''}
                  <dt>Creator:</dt><dd>${artwork.artists[0].label}</dd>
                  <dt>Year:</dt><dd>${artwork.year}</dd>
                  ${artwork.location ? `<dt>Depicted Place:</dt><dd><a href="/?filter_label=Depicted Place&param=f_location.id&value_label=${artwork.location.label}&value=${artwork.location.id}">${artwork.location.label}</a></dd>` : ''}
                  ${artwork.edition ? `<dt>Edition</dt><dd>${artwork.edition}</dd>` : ''}
                  ${tags.join('\n')}
                  <dt>Medium:</dt><dd><a href="/?filter_label=Medium&param=f_medium&value_label=${artwork.medium}&value=${artwork.medium}">${artwork.medium}</a></dd>
                  <dt>Surface:</dt><dd><a href="/?filter_label=Surface&param=f_surface&value_label=${artwork.surface}&value=${artwork.surface}">${artwork.surface}</a></dd>
                  <dt>Size:</dt><dd>${artwork.size_inches}</dd>
                  ${artwork.inscriptions ? `<dt>Inscriptions</dt><dd>${artwork.inscriptions}</dd>` : ''}
                  ${artwork.collection && !artwork.anonymize_collector ? `<dt>Collection:</dt><dd><a href="/?filter_label=Collection&param=f_collection.id&value_label=${artwork.collection.label}&value=${artwork.collection.id}">${artwork.collection.label}</a></dd>` : ''}
                  ${artwork.anonymize_collector ? `<dt>Collection:</dt><dd><a href="/?filter_label=Collection&param=f_anonymize_collector&value_label=Private Collection&value=true">Private Collection</a></dd>` : ''}
                </dl>
                
                ${exhibits.length ? `
                    <h2>Exhibits</h2>
                    ${exhibits.join('\n')}
                ` : ''}
                
                ${prizes.length ? `
                    <h2>Prizes</h2>
                    ${prizes.join('\n')}
                ` : ''}
            `
        }
    }

    get_request_parameters() {
        let params = {
            path: [],
            get: new URLSearchParams(window.location.search)
        }

        // check for url path parameters
        let path_parts = window.location.pathname.split('/');
        if (path_parts.length > 2) {
            for (let p = 2; p < path_parts.length; p++) {
                if (path_parts[p].length) {
                    params.path.push(path_parts[p])
                }
            }
        }

        return params
    }

    clean_elementor_widget(element) {
        let elementor_widgets = element.children('.elementor-widget-container')
        if (elementor_widgets.length) {
            elementor_widgets.each(function() {
                let widget = jQuery(this)
                let style = widget.children('style')

                style.each(function() { jQuery(this).remove() })
                widget.contents().appendTo(element)
                widget.remove()
            })
        }
    }

    load_template(element, template, callback=null) {
        element.load(`${melpAssets.themeUrl}/template-parts/melp/${template}`, function() {
            MELP.apply_site_text(element)
            if (callback) callback()
        })
    }

    /**
     * Clone the page footer's #footer-copyright block into the hamburger drawer.
     *
     * Idempotent (early-returns if the drawer is already populated). Safe to
     * call before either nav.html or footer.html has loaded — if either piece
     * is missing it just no-ops and the caller will retry. Called from both
     * load-template callbacks so whichever finishes last completes the clone.
     */
    populate_hamburger_footer() {
        let hamburger_footer = jQuery('#hamburger-footer-container')
        let footer_copyright = jQuery('#footer-copyright')
        if (!hamburger_footer.length || !footer_copyright.length) return
        if (hamburger_footer.children().length) return
        footer_copyright.clone().appendTo(hamburger_footer)
    }

    determine_medium() {
        let screen_size = window.innerWidth
        return screen_size > this.breakpoints.mobile ? 'desktop' : 'mobile'
    }

    adjust_for_screen_size() {
        // adjust_for_screen_size fires from many sources (window resize, every
        // template-load callback, letter_viewer init, …). The Nav template is
        // loaded async too, so the resize-debounce timer or another template's
        // callback can fire before `sender.nav = new Nav(...)` runs and leave
        // this.nav null. Bail early — the nav.html callback calls us again
        // immediately after it constructs Nav, so we never miss a layout pass.
        if (!this.nav) return

        // Nav hamburger-vs-inline layout switches at the CSS hamburger
        // breakpoint (1120px), NOT the 800px content `medium` below — see
        // adjust_nav_layout for why.
        this.adjust_nav_layout()

        let last_medium = this.medium
        this.medium = this.determine_medium()

        if (this.medium === 'desktop' && last_medium === 'mobile') {
            // fix letter carousel thumbnails
            jQuery('.letter-carousel-thumbnail').each(function() {
                let thumb = jQuery(this)
                let src = thumb.attr('src')
                thumb.attr('src', src.replace('square/330,', 'full/,200'))
            })

            // fix advanced search
            if (this.path === '/letters/') {
                let search_bar = jQuery('#adv-search-bar')
                let search_type_bar = jQuery('#adv-search-type-bar').detach()
                let search_filters = jQuery('#adv-search-filter').detach()

                jQuery('#adv-search-box').prependTo(search_bar)
                search_bar.after(search_type_bar)
                search_filters.prependTo(jQuery('#adv-search-filter-and-results'))
                jQuery('#adv-search-button').html('Search')
                jQuery('#adv-search-modal-search-and-filter-div').empty()
                this.advanced_search.build_filter_boxes()
            }

            // fix letter viewer
            if (this.letter_viewer) {

            }
        }
        else if (this.medium === 'mobile') {
            // fix letter carousel thumbnails
            jQuery('.letter-carousel-thumbnail').each(function() {
                let thumb = jQuery(this)
                let src = thumb.attr('src')
                thumb.attr('src', src.replace('full/,200', 'square/330,'))
            })

            // fix advanced search
            if (this.path === '/letters/') {
                let search_and_filter_div = jQuery('#adv-search-modal-search-and-filter-div')
                if (search_and_filter_div.length && !search_and_filter_div.children().length) {
                    jQuery('#adv-search-box').appendTo(search_and_filter_div)
                    jQuery('#adv-search-type-bar').appendTo(search_and_filter_div)
                    jQuery('#adv-search-filter').appendTo(search_and_filter_div)
                    const filter_icon_url = (typeof melpAssets !== 'undefined' && melpAssets.filterIcon)
                        ? melpAssets.filterIcon
                        : `${this.plugin_url}img/icon_filter.png`
                    jQuery('#adv-search-button').html(`<img src="${filter_icon_url}" alt=""> Search & Filter`)
                    search_and_filter_div.append('<div style="height: 100vh;">&nbsp;</div>')
                    if (jQuery('.select2').length) this.advanced_search.destroy_filter_boxes()
                }
            }

            // fix letter viewer
            if (this.letter_viewer) {

            }
        }

    }

    adjust_nav_layout() {
        // The hamburger button is revealed by CSS below the desktop breakpoint
        // (1120px, $breakpoint-desktop). The nav's DOM layout MUST switch on the
        // same threshold — not the 800px content `medium` — otherwise the
        // 800–1119px band shows the hamburger while the menu and search are still
        // laid out inline: the drawer opens empty and a stray inline search sits
        // beside the trigger. Only re-arrange on an actual crossing so resizes
        // within a band don't thrash the DOM.
        let n = this.nav
        if (!n) return
        let hamburger = window.innerWidth < 1120
        if (hamburger === this._nav_hamburger_mode) return
        this._nav_hamburger_mode = hamburger

        if (hamburger) {
            // Drawer mode: the menu and (non-home) search live inside the
            // hamburger, so nothing nav-related is left inline beside the trigger.
            n.nav_menu.appendTo(n.hamburger_nav_container)
            n.nav_search_button.html('Search')
            if (this.path !== '/') n.nav_search.appendTo(n.hamburger_search_container)
            // Homepage title sits in the nav bar (masthead is single-column here).
            if (this.path === '/' && n.nav_title_and_menu.length) {
                n.nav_title.prependTo(n.nav_title_and_menu)
            }
        } else {
            // Inline desktop nav.
            n.nav_menu.appendTo(n.nav_title_and_menu)
            n.nav_search_button.html('Search Letters')
            if (!['/', '/letters/'].includes(this.path)) {
                let navTitle = jQuery('#nav-title')
                if (navTitle.length) n.nav_search.insertAfter(navTitle)
            }
            // Homepage title floats up into the masthead hero, above the project
            // description. `prependTo`, not `appendTo`: this runs on every resize
            // and would otherwise re-park the title *after* the description that
            // the Nav constructor already placed, flipping the two on desktop.
            if (this.path === '/' && n.masthead_title_and_description.length) {
                n.nav_title.prependTo(n.masthead_title_and_description)
            }
        }
    }
}

class Nav {
    constructor(melp_instance, element) {
        this.melp = melp_instance
        this.element = element
        this.nav_container = jQuery('#nav-container')
        this.nav_search = jQuery('#nav-search')
        this.nav_search_box = jQuery('#nav-search-bar')
        this.nav_search_button = jQuery('#nav-search-button')
        this.nav_title_and_menu = jQuery('#nav-title-and-menu')
        this.nav_title = jQuery('#nav-title')
        this.nav_menu = jQuery('#nav-menu')
        this.masthead = jQuery('#masthead')
        this.masthead_title_and_description = jQuery('#masthead-title-and-description')
        this.masthead_project_description = jQuery('#masthead-project-description')
        this.masthead_byline = jQuery('#masthead-byline')

        this.hamburger_modal = jQuery('#hamburger-modal')
        this.hamburger_open_button = jQuery('#hamburger-open-button')
        this.hamburger_close_button = jQuery('#hamburger-close-button')
        this.hamburger_title_container = jQuery('#hamburger-title-container')
        this.hamburger_search_container = jQuery('#hamburger-search-container')
        this.hamburger_nav_container = jQuery('#hamburger-nav-container')
        this.hamburger_footer_container = jQuery('#hamburger-footer-container')

        let sender = this

        sender.load_navigation()

        sender.nav_search_box.keyup(function(e) {
            if (e.key === 'Enter' && sender.nav_search_box.val().length) {
                window.location.href = `/letters/?search=${sender.nav_search_box.val()}`
            }
        })
        sender.nav_search_button.click(function() {
            if (sender.nav_search_box.val().length) {
                window.location.href = `/letters/?search=${sender.nav_search_box.val()}`
            }
        })

        this.hamburger_open_button.click(function() {
            sender.open_hamburger()
        })
        this.hamburger_close_button.click(function() {
            sender.close_hamburger()
        })

        if (sender.melp.path === '/') {
            // add homepage class
            sender.element.addClass('homepage')
            sender.nav_container.addClass('homepage')
            sender.masthead.addClass('homepage')

            // A11y: the homepage has no visible h1 (the masthead wordmark is
            // a <p> shared with inner pages) — give AT a page heading.
            if (!jQuery('#main-content h1').length) {
                jQuery('#main-content').prepend(`<h1 class="visually-hidden">${escapeHtml(MELP.text('nav_wordmark', 'Maria Edgeworth Letters Project'))}</h1>`)
            }

            // the template nests the search inside #nav-title-and-menu for content pages;
            // on the homepage the search is its own element in the nav, so move it back out
            sender.nav_search.insertAfter(sender.nav_title_and_menu)

            // grab content from elementor divs and place appropriately in masthead
            if (sender.masthead.length && sender.nav_title.length && sender.nav_search.length && sender.masthead_project_description.length && sender.masthead_byline.length) {
                sender.nav_title.appendTo(sender.masthead_title_and_description)
                sender.masthead_project_description.detach().appendTo(sender.masthead_title_and_description)

                // NOTE: the editors/team/design byline is positioned under the
                // "Project Updates" <h2> in the project_updates.html load
                // callback — the heading only exists once that template loads.
            }
        } else if (sender.melp.path.startsWith('/about')) {
            jQuery('#nav-menu-about').addClass('current').attr('aria-current', 'page')
        } else if (sender.melp.path.startsWith('/letters')) {
            jQuery('#nav-menu-current').addClass('current').attr('aria-current', 'page')
            if (sender.melp.path === '/letters/') {
                sender.nav_container.addClass('search')
                sender.nav_search.hide()
            }
        } else if (sender.melp.path.startsWith('/locations')) {
            jQuery('#nav-menu-locations').addClass('current').attr('aria-current', 'page')
        }

        jQuery('.delete-after-load').remove()
    }

    load_navigation() {
        let sender = this
        sender.melp.make_request(
            `/api/corpus/${sender.melp.corpus_id}/SitePage/`,
            'GET',
            {'s_order': 'asc'},
            function(sitePageInfo) {
                if (sitePageInfo.records) {
                    sitePageInfo.records.forEach(function(sitePage) {
                        // `.current` drives visual state; `aria-current="page"`
                        // announces it to assistive tech (WCAG 4.1.2 A).
                        let attrs = ''
                        if (sender.melp.path.startsWith(sitePage.url)) {
                            attrs = ` class="current" aria-current="page"`
                        }
                        sender.nav_menu.append(`
                            <a href="${escapeAttr(sitePage.url)}"${attrs}>${escapeHtml(sitePage.title)}</a>
                        `)
                    })

                    // 3+ menu items → convert inline nav into a hamburger "push" menu
                    // at every viewport (not just <800px). The mobile layout fixer also
                    // moves the menu into the hamburger; jQuery .appendTo on an element
                    // already there is a no-op, so this is safe to run unconditionally.
                    if (sitePageInfo.records.length >= 3) {
                        sender.nav_container.addClass('force-hamburger')
                        sender.hamburger_modal.addClass('push-menu')
                        sender.nav_menu.appendTo(sender.hamburger_nav_container)
                    }
                }
            }
        )
    }

    open_hamburger() {
        // Final fallback: if footer.html happened to load before nav.html AND
        // for some reason the nav.html callback's clone attempt missed, give
        // the drawer footer one last chance to populate before the drawer
        // actually shows. Idempotent, so a no-op if it already populated.
        this.melp.populate_hamburger_footer()

        // Lock the page scroll behind the modal so the body can't scroll under it.
        document.body.classList.add('hamburger-open')
        this.hamburger_modal.css('display', 'flex')
        // #nav-title intentionally stays where the viewport put it (homepage masthead
        // on desktop, otherwise inside #nav-title-and-menu) — the drawer only shows
        // the close X plus the search and nav menu.
        // homepage already moves search in; push-menu mode shows the search on every page
        if (this.melp.path === '/' || this.hamburger_modal.hasClass('push-menu')) {
            this.nav_search.show().appendTo(this.hamburger_search_container)
        }

        // A11y: mark expansion state on the trigger and trap focus inside
        // the modal. The close button is marked `data-initial-focus` (set
        // here rather than in the template so it stays in lockstep with
        // the open/close flow). Esc closes the drawer.
        this.hamburger_open_button.attr('aria-expanded', 'true')
        this.hamburger_close_button.attr('data-initial-focus', '')
        let sender = this
        A11y.trap(this.hamburger_modal, function() { sender.close_hamburger() })
    }

    close_hamburger() {
        document.body.classList.remove('hamburger-open')
        this.hamburger_modal.css('display', 'none')

        // --- Restore #nav-search to its pre-open location. ---
        if (this.melp.path === '/') {
            // Homepage: search lives prepended into #browse-by-container.
            let browseBy = jQuery('#browse-by-container')
            if (browseBy.length) this.nav_search.prependTo(browseBy)
        } else if (this.hamburger_modal.hasClass('push-menu')) {
            // Push-menu pulled the search into the drawer — return it to the nav bar.
            this.nav_search.prependTo(this.nav_title_and_menu)
            // /letters/ intentionally hides the inline search.
            if (this.melp.path === '/letters/') this.nav_search.hide()
        }

        // A11y: flip expansion state, release the focus trap (which also
        // returns focus to the trigger). Safe to call even if trap() was
        // never invoked — release() is a no-op when no state is stashed.
        this.hamburger_open_button.attr('aria-expanded', 'false')
        A11y.release(this.hamburger_modal)
    }
}


/**
 * Homepage "Browse By" bar.
 *
 * The pills are now plain anchor links that navigate to the Topic Index page
 * (`/topic-index/?type=…`). All the in-page tray / sort / stats logic has
 * moved into the TopicIndex class. The only thing this class still does is
 * move the floating #nav-search into the browse-by-container — the same
 * homepage-search-positioning trick the bar relied on before.
 */
class Browser {
    constructor(melp_instance) {
        this.melp = melp_instance
        this.container = jQuery('#browse-by-container')
        this.adjust_nav_search()
    }

    adjust_nav_search() {
        let nav_search = jQuery('#nav-search')
        if (nav_search.length) nav_search.prependTo(this.container)
        else { setTimeout(() => {
            this.adjust_nav_search()
        }, 500) }
    }
}


class LetterCarousel {
    constructor(melp_instance, element) {
        this.melp = melp_instance
        this.element = element
        this.search_criteria = {
            s_date_composed: 'asc'
        }
        this.identifier = `letter-carousel-${element.data('identifier')}`
        let sender = this

        let carousel_size = parseInt(element.data('carousel-size')) || 9

        for (let a = 0; a < element[0].attributes.length; a++) {
            let attr = element[0].attributes[a].name
            let val = element[0].attributes[a].value
            if (attr.startsWith('data-search_')) sender.search_criteria[attr.replace('data-search_', '')] = val
        }

        // Fetch featured letters first, then backfill with non-featured.
        //
        // NOTE the `spool` argument on both requests is false. Spooling walks
        // every page of the result set before invoking the callback, so with a
        // page size of `carousel_size` it used to issue ~38 sequential requests
        // across the whole corpus (~3.8s) only to discard all but the first
        // nine records. The carousel never needs more than one page.
        sender.melp.make_request(
            `/api/corpus/${sender.melp.corpus_id}/Letter/`,
            'GET',
            Object.assign({}, sender.search_criteria, { f_featured: 'true', 'page-size': carousel_size }),
            function(featured_data) {
                let featured = (featured_data.records || [])
                let featured_ids = featured.map(l => l.id)
                let remaining = carousel_size - featured.length

                function buildCarousel(all_letters) {
                    if (element.data('skip_first') && all_letters.length) all_letters.shift()
                    sender.renderCarousel(all_letters, element)
                }

                if (remaining > 0) {
                    sender.melp.make_request(
                        `/api/corpus/${sender.melp.corpus_id}/Letter/`,
                        'GET',
                        Object.assign({}, sender.search_criteria, { 'page-size': remaining + featured.length }),
                        function(other_data) {
                            let others = (other_data.records || []).filter(l => !featured_ids.includes(l.id))
                            buildCarousel(featured.concat(others.slice(0, remaining)))
                        },
                        true, false
                    )
                } else {
                    buildCarousel(featured.slice(0, carousel_size))
                }
            },
            true, false
        )
    }

    renderCarousel(records, element) {
        let sender = this
        let letters_visible = 3
        let gap = 20
        sender.letters_visible = letters_visible
        sender.gap = gap

        // -- Infinite scroll setup --------------------------------------------------
        // The slider renders THREE concatenated copies of the records and the user
        // starts in the middle copy. Next/prev arrows move `current_page` without
        // any bounds clamp; after the slide animation finishes, if we've crossed
        // into the outer (first or third) copy we silently snap back to the same
        // visual position in the middle copy. To the user it's continuous scroll
        // in either direction with no reset to slide 1. Memory is bounded —
        // we hold 3× records regardless of how many times the user clicks.
        sender.original_records = records
        sender.num_pages = Math.ceil(records.length / letters_visible)
        sender.records = [...records, ...records, ...records]
        sender.total_items = sender.records.length
        // Start at the first page of the middle copy.
        sender.current_page = sender.num_pages
        sender.snap_timer = null

        let html = `<div class="letter-carousel-viewport">`
        html += `<div id="${sender.identifier}-slider" class="letter-carousel-slider">`

        let image_size_specifier = 'full/385,'
        if (sender.melp.screen_size <= sender.melp.breakpoints.mobile) image_size_specifier = 'square/385,'

        sender.records.forEach((letter, letter_index) => {
            let image_url = `${sender.melp.iiif_prefix}%2F${letter.identifier}%2F${letter.images[0]}/${image_size_specifier}/0/default.jpg`
            let letter_url = `/letters/${escapeAttr(letter.identifier)}`
            // A11y: a single link wraps both the (decorative, alt="") image and
            // the title, so there's one tab stop with the title as its accessible
            // name. The thumbnail sits in a clip frame so the hover zoom scales
            // inside a fixed box. The label is a <span> — <label> implies a form control.
            html += `
                <div id="${sender.identifier}-letter-${letter_index}" class="letter-carousel-item" data-letter-identifier="${escapeAttr(letter.identifier)}">
                  <a class="letter-carousel-link" href="${letter_url}">
                    <span class="letter-carousel-thumbnail-frame"><img src="${escapeAttr(image_url)}" alt="" class="letter-carousel-thumbnail"></span>
                    <span class="letter-carousel-label">${escapeHtml(letter.title)}</span>
                  </a>
                </div>
            `
        })

        html += `</div>`

        // Arrow buttons inside viewport so they overlay the slider
        html += `<button class="letter-carousel-arrow letter-carousel-arrow-prev" id="${sender.identifier}-arrow-prev" aria-label="Previous letters"></button>`
        html += `<button class="letter-carousel-arrow letter-carousel-arrow-next" id="${sender.identifier}-arrow-next" aria-label="Next letters"></button>`
        html += `</div>`

        // Pager outside viewport so it's not clipped
        html += `<div id="${sender.identifier}-pager" class="letter-carousel-pager" role="group" aria-label="Carousel pages"></div>`
        element.append(html)

        let pager = jQuery(`#${sender.identifier}-pager`)

        if (records.length <= letters_visible) {
            pager.addClass('hidden')
        }

        // Pager dots reflect the real (unique) pages, not the tripled count.
        for (let page_index = 0; page_index < sender.num_pages; page_index++) {
            let activeClass = page_index === 0 ? ' active' : ''
            let currentAttr = page_index === 0 ? ' aria-current="true"' : ''
            pager.append(`
                <button class="letter-carousel-dot${activeClass}" data-page-index="${page_index}" data-letter-index="${page_index * letters_visible}" aria-label="Page ${page_index + 1}"${currentAttr}></button>
            `)
        }

        // Set item widths and initial position (middle copy).
        sender.updateItemWidths()
        sender.slideTo(sender.current_page, false)

        // Next arrow click — no bounds clamp, just advance.
        jQuery(`#${sender.identifier}-arrow-next`).click(function() {
            sender.current_page++
            sender.slideTo(sender.current_page)
            sender.scheduleSnapBack()
        })

        // Prev arrow click — no bounds clamp, just retreat.
        jQuery(`#${sender.identifier}-arrow-prev`).click(function() {
            sender.current_page--
            sender.slideTo(sender.current_page)
            sender.scheduleSnapBack()
        })

        // Dot click — jump to that real page within whichever copy the user is in.
        jQuery(`#${sender.identifier}-pager .letter-carousel-dot`).click(function() {
            let dot = jQuery(this)
            let target_real_page = dot.data('page-index')
            // Anchor to the middle copy so the user has equal headroom either way
            // after a dot jump (otherwise consecutive next-clicks at the right edge
            // would re-snap immediately).
            sender.current_page = sender.num_pages + target_real_page
            sender.slideTo(sender.current_page)
        })

        // Recalculate on resize
        jQuery(window).on('resize', function() {
            sender.updateItemWidths()
            sender.slideTo(sender.current_page, false)
        })
    }

    /**
     * Schedule a silent reposition into the middle copy of the tripled records
     * once the slide animation has finished. Rapid clicks reset the timer so
     * only the most-recent landing position is considered.
     *
     * The slide-transition timing comes from the .letter-carousel-slider CSS
     * (`transition: transform 0.4s ease`). 450ms gives a small safety margin.
     */
    scheduleSnapBack() {
        let sender = this
        if (sender.snap_timer) clearTimeout(sender.snap_timer)
        sender.snap_timer = setTimeout(() => {
            sender.snap_timer = null
            if (sender.num_pages <= 0) return
            // If the user is anywhere in the middle copy (page in [num_pages, 2*num_pages - 1])
            // we're fine. Otherwise wrap back into the middle copy at the same visual offset.
            if (sender.current_page < sender.num_pages || sender.current_page >= sender.num_pages * 2) {
                let wrapped = ((sender.current_page % sender.num_pages) + sender.num_pages) % sender.num_pages
                sender.current_page = sender.num_pages + wrapped
                sender.slideTo(sender.current_page, false)
            }
        }, 450)
    }

    updateItemWidths() {
        this.itemWidth = 385
        let viewportWidth = this.element.find('.letter-carousel-viewport').width()
        let visibleWidth = (this.itemWidth * this.letters_visible) + (this.gap * (this.letters_visible - 1))
        this.startOffset = (viewportWidth - visibleWidth) / 2
    }

    slideTo(page_index, animate) {
        let slider = jQuery(`#${this.identifier}-slider`)
        let pageOffset = page_index * (this.itemWidth + this.gap) * this.letters_visible
        let translateX = this.startOffset - pageOffset

        if (animate === false) {
            slider.css('transition', 'none')
            slider.css('transform', `translateX(${translateX}px)`)
            slider[0].offsetHeight // force reflow
            slider.css('transition', '')
        } else {
            slider.css('transform', `translateX(${translateX}px)`)
        }

        // Active dot tracks the real (mod num_pages) page so dot 1 lights up
        // whenever the user is showing the first batch of unique records, no
        // matter which of the three copies they're physically scrolled into.
        let real_page = this.num_pages > 0
            ? ((page_index % this.num_pages) + this.num_pages) % this.num_pages
            : 0
        jQuery(`#${this.identifier}-pager .letter-carousel-dot`).removeClass('active').removeAttr('aria-current')
        jQuery(`#${this.identifier}-pager .letter-carousel-dot[data-page-index="${real_page}"]`).addClass('active').attr('aria-current', 'true')
    }
}


class ProjectUpdates {
    constructor(melp_instance, element) {
        this.melp = melp_instance
        this.element = element

        // Get Involved card is static content — render it synchronously
        // so it's guaranteed to appear regardless of what happens with
        // the RSS fetch below (which can hang on ddev, fail to parse on
        // a feed with bad XML, etc.). It lands first, then the RSS
        // items prepend in front of it so visual order is unchanged.
        this.render_get_involved()

        fetch('/feed')
            .then(response => response.text())
            .then(str => {
                // PHP notices/warnings (e.g. from a plugin enqueueing assets
                // too early with WP_DEBUG display on) get printed BEFORE the
                // XML prolog and make DOMParser return a parsererror document.
                // Slice from the start of the actual XML so leaked output
                // can't take the whole Project Updates feed down with it.
                let xml_start = str.indexOf('<?xml')
                if (xml_start === -1) xml_start = str.indexOf('<rss')
                if (xml_start > 0) str = str.slice(xml_start)
                return new window.DOMParser().parseFromString(str, "text/xml")
            })
            .then(data => {
                if (data.querySelector('parsererror')) {
                    console.warn('MELP: RSS feed XML failed to parse; skipping feed items.')
                    return
                }
                let feed = jQuery(data)
                let items = feed.find('item')

                if (items.length) {
                    // Render older first, then newer — render_update now
                    // prepends, so order of operations stays the same but
                    // the newest item ends up on top and the Get Involved
                    // card (rendered synchronously above) stays last.
                    if (items.length > 1) this.render_update(jQuery(items[items.length - 2]))
                    this.render_update(jQuery(items[items.length - 1]))
                }
            })
            .catch(err => {
                console.warn('MELP: RSS feed fetch or render failed:', err)
            })
    }

    render_update(item) {
        let title = item.find('title').text()
        let link = item.find('link').text()
        let description = jQuery(new window.DOMParser().parseFromString('<div>' + item.find('description').text() + '</div>', 'text/xml'))
        let featured_image = description.find('.webfeedsFeaturedVisual')
        let image_source = featured_image.attr('src')
        let summary = description.text().replace('[…]', '…')

        let image_html = ''
        if (image_source) {
            image_html = `
                <div class="project-update-image-wrapper">
                  <img src="${escapeAttr(image_source)}" class="project-update-image" alt="">
                </div>`
        }

        // Prepend so the RSS item sits ABOVE the synchronously-rendered
        // Get Involved card. The two render_update calls happen in
        // chronological order (older first), so prepending lands the
        // newer one on top.
        this.element.prepend(`
            <div class="project-update">
                ${image_html}
                <h3 class="project-update-title">${escapeHtml(title)}</h3>
                <p class="project-update-description">${escapeHtml(summary)}</p>
                <a class="project-read-more" href="${escapeAttr(link)}" target="_blank">${escapeHtml(MELP.text('learn_more_label', 'Learn More'))}<span class="visually-hidden"> about ${escapeHtml(title)} (opens in new tab)</span></a>
            </div>
        `)
    }

    render_get_involved() {
        this.element.append(`
            <div class="project-update">
                <div class="project-update-image-wrapper">
                  <img src="/wp-content/themes/understrap-child/assets/images/get_invovled_bg.png" class="project-update-image" alt="">
                </div>
                <h3 class="project-update-title">${escapeHtml(MELP.text('get_involved_title', 'Get Involved!'))}</h3>
                <p class="project-update-description">${escapeHtml(MELP.text('get_involved_body', `Keep track of the progress you and your fellow volunteers have made on this project. Every click counts! Join Maria Edgeworth Letters's community to complete this project and help researchers produce important results. Click "View more stats" to see even more stats.`))}</p>
                <a class="project-read-more" href="${escapeAttr(MELP.text('get_involved_button_url', 'https://www.zooniverse.org/projects/mariaedgeworthletters/maria-edgeworth-letters'))}" target="_blank">${escapeHtml(MELP.text('get_involved_button_label', 'Zooniverse Volunteers'))}<span class="visually-hidden"> (opens in new tab)</span></a>
            </div>
        `)
    }
}


class AdvancedSearch {
    constructor(melp_instance) {
        this.melp = melp_instance
        this.criteria = {
            'page': 1,
            'page-size': 10,
            's_date_composed': 'asc',
            'a_terms_entities': 'entities_mentioned.xml_id,entities_mentioned.entity_type',
            'a_terms_authors': 'author.xml_id',
            'a_terms_recipients': 'recipient.xml_id',
            'a_terms_repos': 'repository.id',
            //'es_debug': 'y'
        }
        this.resetting_filters = false
        this.date_range = {
            min: {
                year: 1791,
                month: 12,
                day: 7
            },
            max: {
                year: 1848,
                month: 7,
                day: 1
            }
        }
        this.filters = {
            PERSON: {
                control_name: 'people',
                identifier: 'xml_id',
                parameters: ['t_author.xml_id|', 't_recipient.xml_id|', 't_entities_mentioned.xml_id|'],
                placeholder: 'Select a person...',
                active: []
            },
            WORK: {
                control_name: 'works',
                identifier: 'xml_id',
                parameters: ['f_entities_mentioned.xml_id|'],
                placeholder: 'Select a work...',
                active: []
            },
            PLACE: {
                control_name: 'places',
                identifier: 'xml_id',
                parameters: ['f_entities_mentioned.xml_id|'],
                placeholder: 'Select a place...',
                active: []
            },
            ORG: {
                control_name: 'repos',
                identifier: 'id',
                parameters: ['f_repository.id|'],
                placeholder: 'Select a repository...',
                active: []
            }
        }
        this.initial_filter = null

        this.search_box = jQuery('#adv-search-box')
        this.search_modal = jQuery('#adv-search-modal')

        let search_button = jQuery('#adv-search-button')
        let apply_filters_button = jQuery('#adv-search-modal-apply-button')
        let modal_close_button = jQuery('#adv-search-modal-close-button')
        let sort_select_box = jQuery('#adv-search-sort-box')

        let sender = this

        // PAGINATION
        jQuery('#adv-search-pagination').on('click', '.adv-search-page-link', function() {
            let link = jQuery(this)
            // `prop('disabled')` honors the real `disabled` attribute now
            // emitted by render_pagination; the `disabled` class is kept
            // as a fallback for any CSS still selecting it.
            if (link.prop('disabled') || link.hasClass('disabled') || link.hasClass('active')) return
            let target_page = parseInt(link.data('page'))
            if (!target_page || target_page === sender.criteria.page) return
            sender.criteria.page = target_page
            sender.load_results()
            let top = jQuery('#adv-search-results-container').offset().top - 20
            if (MELP.prefers_reduced_motion()) jQuery('html, body').scrollTop(top)
            else jQuery('html, body').animate({ scrollTop: top }, 200)
        })

        // SEARCH BOX
        if (this.melp.params.get.get('search')) this.search_box.val(this.melp.params.get.get('search'))
        this.search_box.keyup(function(e) {
            if (e.key === 'Enter') {
                sender.load_results(true)
                // Route through hide_search_modal so the A11y focus trap
                // (set up in show_search_modal) is released on close.
                sender.hide_search_modal()
            }
        })
        search_button.click(function() {
            if (sender.melp.determine_medium() === 'desktop') sender.load_results(true)
            else sender.show_search_modal()
        })
        apply_filters_button.click(function() {
            sender.load_results(true)
            sender.hide_search_modal()
        })
        modal_close_button.click(function() {
            sender.hide_search_modal()
        })
        sort_select_box.change(function() {
            let sorter = jQuery(this)
            sender.criteria.s_date_composed = sorter.val()
            sender.load_results(true)
        })

        // INITIAL FILTERS
        Object.keys(this.filters).forEach(entity_type => {
            if (this.melp.params.get.get(entity_type)) {
                this.filters[entity_type]['initial'] = this.melp.params.get.get(entity_type)
                this.initial_filter = entity_type
            }
        })

        // DATE FILTER
        this.melp.make_request(
            `/api/corpus/${this.melp.corpus_id}/Letter/`,
            'GET',
            {
                a_min_mindate: 'date_composed',
                a_max_maxdate: 'date_composed',
                r_date_composed: '1-1-1768to1860-01-01',
                'page-size': 0},
            function(data) {
                if (data.meta && data.meta.aggregations) {
                    let min = new Date(data.meta.aggregations.mindate)
                    let max = new Date(data.meta.aggregations.maxdate)
                    let from_year_box = jQuery('#adv-search-date-from-year-box')
                    let from_month_box = jQuery('#adv-search-date-from-month-box')
                    let from_day_box = jQuery('#adv-search-date-from-day-box')
                    let to_year_box = jQuery('#adv-search-date-to-year-box')
                    let to_month_box = jQuery('#adv-search-date-to-month-box')
                    let to_day_box = jQuery('#adv-search-date-to-day-box')

                    sender.date_range.min.year = min.getUTCFullYear()
                    sender.date_range.min.month = min.getUTCMonth() + 1
                    sender.date_range.min.day = min.getUTCDate()
                    sender.date_range.max.year = max.getUTCFullYear()
                    sender.date_range.max.month = max.getUTCMonth() + 1
                    sender.date_range.max.day = max.getUTCDate()
                    
                    from_year_box.attr('placeholder', sender.date_range.min.year)
                    from_month_box.attr('placeholder', sender.date_range.min.month)
                    from_day_box.attr('placeholder', sender.date_range.min.day)
                    to_year_box.attr('placeholder', sender.date_range.max.year)
                    to_month_box.attr('placeholder', sender.date_range.max.month)
                    to_day_box.attr('placeholder', sender.date_range.max.day)

                    jQuery('#adv-search-dates-apply-button').click(function() {
                        let from_year = from_year_box.val() ? from_year_box.val() : sender.date_range.min.year
                        let from_month = from_month_box.val() ? from_month_box.val() : sender.date_range.min.month
                        let from_day = from_day_box.val() ? from_day_box.val() : sender.date_range.min.day
                        let to_year = to_year_box.val() ? to_year_box.val() : sender.date_range.max.year
                        let to_month = to_month_box.val() ? to_month_box.val() : sender.date_range.max.month
                        let to_day = to_day_box.val() ? to_day_box.val() : sender.date_range.max.day

                        let from_date = `${from_year}-${from_month}-${from_day}`
                        let to_date = `${to_year}-${to_month}-${to_day}`

                        if (!isNaN(new Date(from_date)) && !isNaN(new Date(to_date))) {
                            sender.criteria['r_date_composed'] = `${from_date}to${to_date}`
                            sender.load_results(true)
                        }
                    })
                }
            }
        )

        // ENTITY FILTERS
        this.melp.make_request(
            `/api/corpus/${this.melp.corpus_id}/Entity/`,
            'GET',
            {'s_name': 'asc', 'page-size': 10000},
            function(data) {
                if (data.records) {
                    data.records.forEach(e => {
                        let entity_type = e.entity_type
                        let filter = sender.filters[entity_type]
                        let select_box = jQuery(`#adv-search-${filter.control_name}-filter`)
                                                select_box.append(`<option value="${escapeAttr(e[filter.identifier])}">${escapeHtml(e.name)}</option>`)
                    })

                    if (sender.melp.medium === 'desktop') sender.build_filter_boxes()

                    jQuery('.filter-box').change(function() {
                        let select_box = jQuery(this)
                        sender.perform_entity_filter(select_box.data('entity_type'))
                    })

                    if (sender.initial_filter) {
                        jQuery(`.filter-box[data-entity_type=${sender.initial_filter}]`).val(sender.filters[sender.initial_filter]['initial']).trigger('change')
                        jQuery(`#adv-search-${sender.filters[sender.initial_filter].control_name}-filter-container`).prop('open', true)
                    }
                }
            },
            true,
            true
        )

        // CLEAR FILTER BUTTON
        jQuery('#adv-search-clear-filter-button').click(function() {
            sender.resetting_filters = true

            jQuery('.filter-box').each(function() {
                let filter_box = jQuery(this)
                filter_box.val(null).trigger('change')
            })

            sender.load_results(true)
            sender.resetting_filters = false
        })

        if (!this.initial_filter) this.load_results(true)
    }

    load_results(reset=false) {
        let results_div = jQuery('#adv-search-results')
        let total_counter = jQuery('#adv-search-total-results')
        let current_counter = jQuery(`#adv-search-current-result`)
        let last_counter = jQuery('#adv-search-last-result')
        let pagination_div = jQuery('#adv-search-pagination')
        let sender = this

        if (reset){
            sender.criteria.page = 1
        }

        results_div.empty()
        pagination_div.empty()
        current_counter.html('0')
        last_counter.html('0')

        if (sender.search_box.val().length) {
            let all_fields = jQuery('#adv-search-type-metadata').is(':checked')

            if (all_fields) sender.criteria.q = sender.search_box.val().trim()
            else sender.criteria.q_html = sender.search_box.val().trim()
            // Ask Corpora for ES highlight fragments from the letters' html
            // field — they feed the excerpt under each result title.
            sender.criteria.highlight_fields = 'html'
        } else {
            if ('q' in sender.criteria) delete sender.criteria['q']
            if ('q_html' in sender.criteria) delete sender.criteria['q_html']
            if ('highlight_fields' in sender.criteria) delete sender.criteria['highlight_fields']
        }


        sender.melp.make_request(
            `/api/corpus/${sender.melp.corpus_id}/Letter/`,
            'GET',
            sender.criteria,
            function(data) {
                if (data.meta && data.records) {
                    let page = data.meta.page
                    let page_size = data.meta.page_size
                    let total = data.meta.total
                    let first_on_page = total === 0 ? 0 : ((page - 1) * page_size) + 1
                    let last_on_page = Math.min(page * page_size, total)

                    total_counter.html(total)
                    current_counter.html(first_on_page)
                    last_counter.html(last_on_page)

                    data.records.forEach((letter, letter_index) => {
                        let letter_count = ((page - 1) * page_size) + letter_index + 1

                        // Search-term excerpt: join the first two ES highlight
                        // fragments (sanitized — match terms become <strong>);
                        // the CSS clamps the rendered text to two lines.
                        let excerpt_html = ''
                        let fragments = letter._search_highlights ? letter._search_highlights.html : null
                        if (fragments && fragments.length) {
                            let excerpt = fragments.slice(0, 2).map(highlightFragmentToHtml).filter(f => f.length).join(' … ')
                            if (excerpt.length) excerpt_html = `<p class="adv-search-result-excerpt">…${excerpt}…</p>`
                        }

                        results_div.append(`
                            <div id="adv-search-result-${letter.id}" class="adv-search-result" data-id="${letter.id}" data-count="${letter_count}">
                                <a href="/letters/${escapeAttr(letter.identifier)}" target="_blank"><h3>${escapeHtml(letter.title)}<span class="visually-hidden"> (opens in new tab)</span></h3></a>
                                ${excerpt_html}
                            </div>
                        `)
                    })

                    sender.render_pagination(page, page_size, total)

                    if (data.meta.aggregations) {
                        let relevant = { PERSON: [], WORK: [], PLACE: [], ORG: [] }

                        if (data.meta.aggregations.authors) {
                            Object.keys(data.meta.aggregations.authors).forEach(author_id => relevant.PERSON.push(author_id))
                        }
                        if (data.meta.aggregations.recipients) {
                            Object.keys(data.meta.aggregations.recipients).forEach(recip_id => relevant.PERSON.push(recip_id))
                        }
                        if (data.meta.aggregations.entities) {
                            Object.keys(data.meta.aggregations.entities).forEach(entity => {
                                let [xml_id, entity_type] = entity.split('|||')
                                relevant[entity_type].push(xml_id)
                            })
                        }
                        if (data.meta.aggregations.repos) {
                            Object.keys(data.meta.aggregations.repos).forEach(repo_id => relevant.ORG.push(repo_id))
                        }

                        relevant.PERSON = Array.from(new Set(relevant.PERSON))

                        Object.keys(relevant).forEach(entity_type => {
                            let filter = sender.filters[entity_type]
                            jQuery(`#adv-search-${filter.control_name}-filter option`).each(function() {
                                let option = jQuery(this)
                                if (!relevant[entity_type].includes(option.attr('value'))) {
                                    option.prop('disabled', true)
                                } else option.prop('disabled', false)
                            })
                        })
                    }
                }
            }
        )
    }

    render_pagination(page, page_size, total) {
        let pagination_div = jQuery('#adv-search-pagination')
        pagination_div.empty()

        let total_pages = Math.max(1, Math.ceil(total / page_size))
        if (total <= page_size) return

        let prev_dis = page <= 1
        let next_dis = page >= total_pages

        // Sliding window of up to 5 consecutive page numbers, centered on the
        // current page and clamped to [1, total_pages] — no ellipsis, no
        // jumped-to last page. First/Last buttons handle the extremes.
        let window_size = 5
        let start = Math.max(1, Math.min(page - 2, total_pages - window_size + 1))
        let end = Math.min(total_pages, start + window_size - 1)
        let visible = []
        for (let p = start; p <= end; p++) visible.push(p)

        // A11y: the visible word ("First") leads the accessible name
        // (WCAG 2.5.3 Label in Name) — arrow glyphs are aria-hidden and a
        // visually-hidden " page" suffix completes the announcement.
        // aria-current="page" marks the active page and a real `disabled`
        // attribute sits on the unavailable directional buttons.
        // `.disabled` class is preserved for existing CSS hooks.
        let navBtn = (extra_cls, text, target_page, disabled, pre_glyph, post_glyph) => {
            let cls = `adv-search-page-link ${extra_cls}${disabled ? ' disabled' : ''}`.trim()
            let disAttr = disabled ? ' disabled' : ''
            let pre = pre_glyph ? `<span aria-hidden="true">${pre_glyph} </span>` : ''
            let post = post_glyph ? `<span aria-hidden="true"> ${post_glyph}</span>` : ''
            return `<button type="button" class="${cls}" data-page="${target_page}"${disAttr}>${pre}${text}<span class="visually-hidden"> page</span>${post}</button>`
        }

        let html = ''
        html += navBtn('adv-search-page-first', 'First', 1, prev_dis, '&laquo;', '')
        html += navBtn('adv-search-page-prev', 'Prev', page - 1, prev_dis, '&lsaquo;', '')

        visible.forEach(p => {
            let is_active = p === page
            let active_cls = is_active ? ' active' : ''
            let aria_current = is_active ? ' aria-current="page"' : ''
            html += `<button type="button" class="adv-search-page-link${active_cls}" data-page="${p}"${aria_current} aria-label="Page ${p}">${p}</button>`
        })

        html += navBtn('adv-search-page-next', 'Next', page + 1, next_dis, '', '&rsaquo;')
        html += navBtn('adv-search-page-last', 'Last', total_pages, next_dis, '', '&raquo;')

        pagination_div.html(html)
    }

    build_filter_boxes() {
        let sender = this
        jQuery('.filter-box').each(function() {
            let filter_box = jQuery(this)
            let entity_type = filter_box.data('entity_type')
            let filter = sender.filters[entity_type]
            filter_box.select2({
                placeholder: filter.placeholder,
                dropdownParent: jQuery(`#adv-search-${filter.control_name}-filter-container`),
                width: '100%',
                allowClear: true,
                minimumResultsForSearch: 0
            })
        })
    }

    destroy_filter_boxes() {
        jQuery('.filter-box').each(function() {
            let filter_box = jQuery(this)
            filter_box.select2('destroy')
        })
    }

    perform_entity_filter(entity_type) {
        let select_box = jQuery(`#adv-search-${this.filters[entity_type].control_name}-filter`)
        let entities_requested = select_box.val()
        let entities_added = []
        let entities_removed = []

        this.filters[entity_type].active.forEach(current_entity => {
            if (!entities_requested.includes(current_entity)) {
                entities_removed.push(current_entity)
            }
        })
        entities_requested.forEach(new_entity => {
            if (!this.filters[entity_type].active.includes(new_entity)) {
                entities_added.push(new_entity)
            }
        })

        this.filters[entity_type].active = entities_requested
        entities_added.forEach(entity => {
            this.filters[entity_type].parameters.forEach(param => {
                this.add_criteria(param, entity)
            })
        })
        entities_removed.forEach(entity => {
            this.filters[entity_type].parameters.forEach(param => {
                this.remove_criteria(param, entity)
            })
        })

        if (this.filters['PERSON'].active.length === 1) this.criteria['operator'] = 'or'
        else delete this.criteria['operator']

        if (!this.resetting_filters) this.load_results(true)
    }

    add_criteria(key, value) {
        if (key in this.criteria) {
            let current_values = this.criteria[key].split('__')
            if (!current_values.includes(value)) current_values.push(value)
            this.criteria[key] = current_values.join('__')
        } else {
            this.criteria[key] = value
        }
    }

    remove_criteria(key, value) {
        if (key in this.criteria) {
            let current_values = this.criteria[key].split('__')
            current_values = current_values.filter(function(e) { return e !== value })
            if (!current_values.length) delete this.criteria[key]
            else this.criteria[key] = current_values.join('__')
        }
    }

    show_search_modal() {
        this.search_modal.css('display', 'flex')
        jQuery('body').css('position', 'fixed')

        // A11y: mark the close button as the initial focus target and trap
        // focus inside the modal. Esc closes via the same path as the X.
        jQuery('#adv-search-modal-close-button').attr('data-initial-focus', '')
        let sender = this
        A11y.trap(this.search_modal, function() { sender.hide_search_modal() })
    }

    hide_search_modal() {
        this.search_modal.css('display', 'none')
        jQuery('body').css('position', 'unset')

        // A11y: release focus trap (and restore focus to the trigger
        // captured at open time). Safe to call even when modal was
        // closed via the inline `.css('display', 'none')` path used by
        // search-on-Enter and apply-filters — release() is a no-op when
        // no trap state is stashed on the modal.
        A11y.release(this.search_modal)
    }
}


class LetterViewer {
    constructor(melp_instance, letter_id, container) {
        this.melp = melp_instance
        this.letter_id = letter_id
        this.container = container
        this.letter = null
        this.template_html = null
        this.letter_viewer = null
        this.previous_letter = null
        this.next_letters = []
        this.thumbnail_div = null
        this.viewer_div = null
        this.transcript_div = null
        this.pages_highlighted = []
        this.pbs = null
        this.last_pb_scrolled = null
        this.scroll_timer = null
        this.current_page = 0
        this.entities = {}
        this.column_arrangement = 'two-thirds'
        // High-contrast toggle for the OpenSeadragon viewer. OSD has no
        // built-in image-adjustment controls, so this drives a CSS filter
        // on the viewer canvas (.high-contrast in _global.scss). Lives on
        // the class so the setting survives paging between letter images
        // (each page tears down and re-creates the viewer + toolbar).
        this.high_contrast = false

        let sender = this

        // The template markup and the letter data are fetched in parallel,
        // and nothing is injected into the page until BOTH are in hand —
        // render() decides the layout from the data first (e.g. a letter
        // with no transcription never renders the transcript column or its
        // controls), instead of rendering everything and hiding pieces
        // after the fact.
        let pending = 3
        function done() { if (--pending === 0) sender.render() }

        jQuery.get(`${melpAssets.themeUrl}/template-parts/melp/letter_viewer.html`, function(html) {
            sender.template_html = html
        }).always(done)

        this.melp.make_request(
            `/api/corpus/${this.melp.corpus_id}/Letter/`,
            'GET',
            {s_date_composed: 'asc', only: 'identifier', 'page-size': 1000},
            function(sorted_identifiers) {
                if (sorted_identifiers.records) {
                    let last_letter = null
                    let current_found = false

                    sorted_identifiers.records.forEach(l => {
                        if (l.identifier === letter_id) {
                            sender.previous_letter = last_letter
                            current_found = true
                        }
                        // Collect the next 9 chronologically subsequent letters — feeds the
                        // "Up Next" carousel (matches its default carousel-size of 9). The
                        // previous-letter arrow still uses next_letters[0].
                        else if (current_found && sender.next_letters.length < 9) sender.next_letters.push(l.identifier)
                        else last_letter = l.identifier
                    })
                }
                done()
            }
        ).fail(done)

        this.melp.make_request(
            `/api/corpus/${this.melp.corpus_id}/Letter/?f_identifier=${letter_id}`,
            'GET',
            {},
            function(data) {
                if (data.records && data.records.length === 1) {
                    sender.letter = data.records[0]
                }
                done()
            }
        ).fail(done)
    }

    render() {
        if (this.template_html === null) return
        let sender = this
        let letter = this.letter

        // Decide whether this letter has a real transcription BEFORE any
        // markup is displayed. A letter with no transcription still comes
        // back with structural scaffolding — an empty salutation, empty
        // <p>s, empty .closer divs — plus the date in .dateline. Strip the
        // date (shown in the metadata panel anyway) and page-break anchors
        // before checking for real prose so a date-only letter reads as
        // "no transcription".
        let has_transcript = false
        if (letter) {
            let $probe = jQuery('<div>').html(letter.html || '')
            $probe.find('.dateline, .page-break').remove()
            has_transcript = $probe.text().trim().length > 0
        }

        // Build the viewer from a detached fragment so layout decisions
        // happen before anything is displayed.
        let fragment = jQuery('<div>').html(this.template_html)
        if (has_transcript) {
            fragment.find('#letter-transcript-pending').remove()
        } else {
            // No transcription yet. The column itself stays — the letter still
            // reads as a two-column page and the Display Options toolbar keeps
            // working — but everything that describes a transcript which isn't
            // there is pruned: the Transcript label, View XML link and Remove
            // Annotations toggle (#letter-xml), and the annotations "About"
            // popover. #letter-stretcher only exists to give the transcript
            // scroll room, so it goes too, leaving the placeholder alone in
            // the viewer. The `transcript-pending` class centers it.
            //
            // "Transcription only" goes as well: it would hide the letter
            // image to show nothing but the placeholder. The remaining three
            // arrangements still let the reader widen or hide the empty column.
            fragment.find('#letter-xml, #letter-about-toggle, #letter-about-modal, #letter-stretcher').remove()
            fragment.find('.letter-columns-button[data-arrangement="transcription-only"]').remove()
            fragment.find('#letter-transcript-viewer').addClass('transcript-pending')
        }
        MELP.apply_site_text(fragment)
        this.container.empty().append(fragment.contents())

        this.thumbnail_div = jQuery('#letter-image-thumbs')
        this.viewer_div = jQuery('#letter-image-viewer')
        this.transcript_div = jQuery('#letter-transcript-viewer')
        this.melp.adjust_for_screen_size()

        if (!letter) return

        // fix dates
        let date_composed = letter.date_composed
        let date_transcribed = letter.date_transcribed

        if (date_composed && date_composed.indexOf('T')) date_composed = date_composed.split('T')[0]
        else date_composed = 'N/A'

        if (date_transcribed && date_transcribed.indexOf('T')) date_transcribed = date_transcribed.split('T')[0]
        else date_transcribed = 'N/A'

        // set title
        jQuery('#letter-title').text(letter.title)

        // set prev and next letter links
        // A11y: templates render these with aria-disabled="true"
        // and tabindex="-1" so they're inert before hydration.
        // Once a real target exists we strip those so the link
        // is keyboard- and AT-reachable; if no neighbour exists
        // we `hide()` (display:none drops it from the AT tree).
        let prev_letter = jQuery('#previous-letter-link')
        let next_letter = jQuery('#next-letter-link')
        if (sender.previous_letter) {
            prev_letter
                .attr('href', `/letters/${sender.previous_letter}`)
                .removeAttr('aria-disabled')
                .removeAttr('tabindex')
        } else {
            prev_letter.hide()
        }
        if (sender.next_letters.length) {
            next_letter
                .attr('href', `/letters/${sender.next_letters[0]}`)
                .removeAttr('aria-disabled')
                .removeAttr('tabindex')
        } else {
            next_letter.hide()
        }

        // set metadata fields
        jQuery('#letter-xml-link').attr('href', `${sender.melp.github_prefix}${sender.letter_id}`)
        sender.set_metadata_field('author', letter.author ? letter.author.name : null)
        sender.set_metadata_field('transcriber', letter.transcriber)
        sender.set_metadata_field('repository', letter.repository ? letter.repository.name : null)
        sender.set_metadata_field('recipient', letter.recipient ? letter.recipient.name : null)
        sender.set_metadata_field('first-edition-date', date_transcribed)
        sender.set_metadata_field('collection', letter.collection, true)
        sender.set_metadata_field('written-date', date_composed)
        sender.set_metadata_field('general-editors', letter.general_editors)

        // set credits section
        jQuery('#letter-credit-contents').html(`
            ${letter.repository ? `This image has been provided by ${escapeHtml(letter.repository.name)}.`: ''}
            MELP is sponsored by Texas A&M University, University of Tennessee, Wake Forest University, Xavier University of Louisiana, and Southern Methodist University.
        `)

        // build thumbnails — real <button>s so page switching
        // is keyboard operable; the button carries the
        // accessible name, the img stays decorative.
        letter.images.forEach((image, image_index) => {
            sender.thumbnail_div.append(`
                <button type="button" class="letter-thumbnail-button" aria-label="Page ${image_index + 1}">
                  <img class="letter-thumbnail"
                  alt=""
                  src="${escapeAttr(sender.melp.iiif_prefix)}%2F${escapeAttr(letter.identifier)}%2F${escapeAttr(image)}/full/,110/0/default.jpg"
                  onerror="melp.letter_viewer.register_missing_image(${image_index});"
                  data-image_no="${image_index}"
                  data-iiif_identifier="${escapeAttr(sender.melp.iiif_prefix)}%2F${escapeAttr(letter.identifier)}%2F${escapeAttr(image)}">
                </button>
            `)
        })

        // inject transcription and identify page breaks. When there's no
        // transcription the viewer holds the "coming soon" placeholder
        // instead — see the fragment pruning above — so nothing is injected.
        if (has_transcript) sender.transcript_div.prepend(letter.html)
        sender.pbs = jQuery('.page-break')

        // determine whether letter is editor approved
        // if not, inject disclaimer message ABOVE the
        // transcript (prepend runs after the transcript
        // prepend, so it lands as the first child). Skipped
        // when there's no transcript — nothing to disclaim.
        if (has_transcript && !letter.editor_approved) {
            // disclaimer_html is wp_kses-sanitized on save.
            sender.transcript_div.prepend(`
                <div class="alert alert-melp">${MELP.text('disclaimer_html', `
                    <p>This transcription has not undergone final editorial review.
                    If you would like to suggest a correction to the editors, please email: <a href="mailto:mariaedgeworthletters@gmail.com">mariaedgeworthletters@gmail.com</a></p>
                    <p>Please include the letter date, recipient, and URL along with the suggested correction(s).</p>
                `)}</div>
            `)
        }

        // register entities
        if (letter.entities_mentioned && letter.entities_mentioned.length) {
            letter.entities_mentioned.forEach(ent => {
                let ent_key = `${ent.entity_type}-${ent.xml_id}`
                let ent_box = jQuery(`#letter-${ent.entity_type}-facet .letter-facet-items`)
                let ent_url = `/letters/?${ent.entity_type}=${ent.xml_id}`

                if (!(ent_key in sender.entities)) {
                    sender.entities[ent_key] = ent
                }

                ent_box.append(`
                    <a href="${escapeAttr(ent_url)}">${escapeHtml(ent.name)}</a>
                `)
            })
        }

        // Any facet left empty gets an explanatory line
        // instead of a blank dropdown area.
        let facet_empty_labels = {
            PERSON: MELP.text('facet_empty_person', 'No people mentioned'),
            WORK: MELP.text('facet_empty_work', 'No works mentioned'),
            PLACE: MELP.text('facet_empty_place', 'No places mentioned')
        }
        Object.keys(facet_empty_labels).forEach(ent_type => {
            let facet_box = jQuery(`#letter-${ent_type}-facet .letter-facet-items`)
            if (facet_box.length && !facet_box.children().length) {
                facet_box.append(`<p class="letter-facet-empty">${facet_empty_labels[ent_type]}</p>`)
            }
        })

        // rig up entity tooltips
        jQuery('span.entity').each(function() {
            let entity = jQuery(this)

            // A11y: the chips are <span>s, so make them real
            // keyboard stops that announce as toggling buttons
            // (WCAG 2.1.1 / 4.1.2).
            entity.attr({
                'tabindex': '0',
                'role': 'button',
                'aria-expanded': 'false'
            })

            let tip = tippy(entity[0], {
                arrow: true,
                animation: 'fade',
                trigger: 'click',
                interactive: true,
                allowHTML: true,
                content: 'Loading...',
                onShow(instance) {
                    entity.attr('aria-expanded', 'true')
                    let ent_key = `${entity.data('entity_type')}-${entity.data('entity_id')}`
                    if (ent_key in sender.entities) sender.populate_entity_details(entity, instance)
                    else {
                        sender.melp.make_request(
                            `/api/corpus/${sender.melp.corpus_id}/Entity/`,
                            'GET',
                            {f_xml_id: entity.data('entity_id'), f_entity_type: entity.data('entity_type')},
                            function(data) {
                                if (data.records && data.records.length) {
                                    sender.entities[ent_key] = data.records[0]
                                    sender.populate_entity_details(entity, instance)
                                }
                            }
                        )
                    }
                },
                onHide() {
                    entity.attr('aria-expanded', 'false')
                }
            })

            // Enter/Space toggle the popup; Esc closes it and
            // keeps focus on the chip.
            entity.on('keydown', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (tip.state.isVisible) tip.hide()
                    else tip.show()
                } else if (e.key === 'Escape' && tip.state.isVisible) {
                    tip.hide()
                }
            })
        })

        // setup column arrangement functionality
        let viewer_row = jQuery('#letter-viewer')
        let image_col = jQuery('#letter-image-and-license')
        let trans_col = jQuery('#letter-xml-and-transcript')
        let sequence_links = jQuery('.letter-sequence-link')
        let column_buttons = jQuery('#letter-columns .letter-columns-button')

        function applyColumnArrangement(arrangement) {
            sender.column_arrangement = arrangement
            viewer_row.css('flex-direction', 'row')
            sequence_links.show()
            image_col.css('display', '')
            trans_col.css('display', '')
            if (arrangement === 'half') {
                image_col.css('width', '50%')
                trans_col.css('width', '50%')
            } else if (arrangement === 'two-thirds') {
                image_col.css('width', '60%')
                trans_col.css('width', '40%')
            } else if (arrangement === 'image-only') {
                image_col.css('width', '100%')
                trans_col.css('display', 'none')
            } else if (arrangement === 'transcription-only') {
                image_col.css('display', 'none')
                trans_col.css('width', '100%')
            }
            column_buttons.removeClass('active').attr('aria-pressed', 'false')
            column_buttons.filter(`[data-arrangement="${arrangement}"]`).addClass('active').attr('aria-pressed', 'true')
            let current_image = jQuery('.letter-thumbnail.current').data('image_no')
            sender.show_letter_image(current_image, true)
        }

        column_buttons.click(function() {
            applyColumnArrangement(jQuery(this).data('arrangement'))
        })

        // reflect the default arrangement on the buttons
        column_buttons.filter(`[data-arrangement="${sender.column_arrangement}"]`).addClass('active')

        // "remove annotations" toggle: collapse <br> line breaks so the transcript flows inline
        let transcript_viewer = jQuery('#letter-transcript-viewer')
        jQuery('#letter-remove-annotations').on('change', function() {
            transcript_viewer.toggleClass('annotations-removed', jQuery(this).is(':checked'))
        })

        // "About the Letters" popover — the ? toggle opens an
        // info dialog (focus-trapped, Esc / outside-click /
        // X-button close). While open the ? is hidden and the
        // X close button occupies its corner.
        let about_toggle = jQuery('#letter-about-toggle')
        let about_modal = jQuery('#letter-about-modal')
        function close_about() {
            if (about_modal.prop('hidden')) return
            about_modal.prop('hidden', true)
            about_toggle.prop('hidden', false).attr('aria-expanded', 'false')
            A11y.release(about_modal) // returns focus to the ? toggle
            jQuery(document).off('click.letterAbout')
        }
        function open_about() {
            about_modal.prop('hidden', false)
            about_toggle.attr('aria-expanded', 'true')
            A11y.trap(about_modal, close_about)
            // Hide the ? after trap() stashes it as the
            // focus-return target (release() re-shows it first).
            about_toggle.prop('hidden', true)
            // Close when clicking outside the popover/toggle.
            setTimeout(function() {
                jQuery(document).on('click.letterAbout', function(e) {
                    if (!jQuery(e.target).closest('#letter-about-modal, #letter-about-toggle').length) close_about()
                })
            }, 0)
        }
        about_toggle.on('click', open_about)
        jQuery('#letter-about-close').on('click', close_about)

        // setup "up next" carousel
        if (sender.next_letters.length) {
            let carousel_container = jQuery('#letter-up-next-carousel')
            carousel_container.attr('data-search_t_identifier', `${sender.next_letters.join('__')}`)
            let carousel = new LetterCarousel(sender.melp, carousel_container)
        } else jQuery('#letter-up-next').hide()

        // rig up thumbnail click event (the wrapping button
        // is the control; the img carries the data attrs)
        jQuery('.letter-thumbnail-button').click(function () {
            sender.show_letter_image(jQuery(this).find('.letter-thumbnail').data('image_no'), true)
        })

        // rig up transcript scroll event to catch page rollover
        sender.transcript_div.scroll(e => {
            let y_top = sender.transcript_div.offset().top
            let y_bot = y_top + 200

            sender.pbs.each(function() {
                let pb = jQuery(this)
                let pb_y = pb.offset().top
                if (pb_y > y_top && pb_y < y_bot) sender.last_pb_scrolled = pb
            })

            if (sender.last_pb_scrolled) {
                clearTimeout(sender.scroll_timer)
                sender.scroll_timer = setTimeout(() => {
                    let page_no = parseInt(sender.last_pb_scrolled.data('page')) - 1
                    if (page_no !== sender.current_page) sender.show_letter_image(page_no)
                }, 1000)
            }
        })

        // create citation info
        let citation_months = ["January","February","March","April","May","June","July","August","September","October","November","December"]
        let citation_date = new Date()
        // The citation text itself is the button's accessible
        // name (WCAG 2.5.3) — the copy hint and the copied
        // confirmation live in visually-hidden/status spans.
        let citation_div = jQuery('#letter-citation')
        citation_div.html(`
            <span id="letter-citation-text">"${escapeHtml(letter.title)}," <i>Maria Edgeworth Letters Project</i>,${letter.collection ? ` ${escapeHtml(letter.collection)},` : ''}${letter.repository ? ` Courtesy of ${escapeHtml(letter.repository.name)}` : ''}. Retrieved from ${escapeHtml(window.location.href)}, ${citation_months[citation_date.getMonth()]} ${citation_date.getDate()}, ${citation_date.getFullYear()}.</span>
            <span class="visually-hidden">Select to copy this citation to your clipboard.</span>
        `)
        citation_div.click(function() {
            navigator.clipboard.writeText(jQuery('#letter-citation-text').text().trim())
            let status = jQuery('#letter-citation-status')
            status.text('')
            setTimeout(() => status.text('Citation copied to clipboard.'), 100)
        })
        tippy(citation_div[0], {
            arrow: true,
            animation: 'fade',
            trigger: 'click',
            interactive: true,
            allowHTML: true,
            content: '<span style="color: black;">Copied to clipboard!</span>',
        })

        // show the first page image
        sender.show_letter_image(0)
    }

    set_metadata_field(field, value, linkify=false) {
        if (value) {
            let el = jQuery(`#letter-metadata-${field}`)
            if (linkify && /https?:\/\//.test(value)) {
                // Some metadata (e.g. Huntington collection entries) embeds
                // bare URLs in free text — turn them into real links. Text is
                // escaped piecewise so the only HTML injected is our anchors.
                let url_re = /https?:\/\/\S+/g
                let html = ''
                let last = 0
                let m
                while ((m = url_re.exec(value)) !== null) {
                    let url = m[0]
                    // Trailing punctuation belongs to the sentence, not the URL.
                    let trimmed = url.replace(/[.,;:)\]]+$/, '')
                    html += escapeHtml(value.slice(last, m.index))
                    html += `<a href="${escapeAttr(trimmed)}" target="_blank" rel="noopener">${escapeHtml(trimmed)}</a>`
                    html += escapeHtml(url.slice(trimmed.length))
                    last = m.index + url.length
                }
                html += escapeHtml(value.slice(last))
                el.html(html)
            } else {
                el.text(value)
            }
        } else {
            jQuery(`#letter-metadata-${field}-div`).hide()
        }
    }

    show_top_of_letter() {
        let top_point = new OpenSeadragon.Point(0,0)
        this.letter_viewer.viewport.panTo(top_point)
        this.letter_viewer.viewport.applyConstraints()
    }

    show_letter_image(index, scrollTextIntoView=false) {
        const image = jQuery(`[data-image_no="${index}"]`)
        let viewer_options = {
            id:                 "letter-image-viewer",
            prefixUrl:          `${this.melp.plugin_url}/js/openseadragon/images/`,
            preserveViewport:   false,
            visibilityRatio:    1,
            minZoomLevel:       .25,
            maxZoomLevel:       5,
            defaultZoomLevel:   0,
            homeFillsViewer:    true,
            showRotationControl: true,
            tileSources:   [image.data('iiif_identifier')],
        }

        this.viewer_div.empty()
        if (this.melp.determine_medium() === 'mobile') {
            viewer_options['toolbar'] = 'letter-image-toolbar'
            jQuery('#letter-image-toolbar').empty()
        }

        this.letter_viewer = OpenSeadragon(viewer_options)
        let sender = this

        // fix toolbar styling
        let toolbar = jQuery('div[title="Zoom in"]').parent()
        toolbar.css('margin-top', '10px')
        toolbar.css('margin-left', '10px')
        toolbar.css('display', 'flex')
        toolbar.css('gap', '10px')
        toolbar.css('cursor', 'pointer')

        // HIGH CONTRAST TOGGLE — custom control appended after the OSD
        // buttons (zoom/home/fullscreen/rotate). Toggles .high-contrast on
        // the viewer mount; the CSS filter lives in _global.scss so the
        // effect is purely presentational and composes with zoom/pan/rotate.
        let contrast_button = jQuery(`
            <button type="button" class="letter-contrast-button"
                    title="Toggle high contrast"
                    aria-label="Toggle high contrast"
                    aria-pressed="${this.high_contrast}">
                <img src="/wp-content/themes/understrap-child/assets/images/contrast.png" alt="" />
            </button>
        `)
        toolbar.append(contrast_button)
        this.viewer_div.toggleClass('high-contrast', this.high_contrast)
        contrast_button.click(function() {
            sender.high_contrast = !sender.high_contrast
            sender.viewer_div.toggleClass('high-contrast', sender.high_contrast)
            contrast_button.attr('aria-pressed', sender.high_contrast)
        })

        // rig up event to show top of letter once image loaded
        this.letter_viewer.addHandler('open', function () {
            let tiledImage = sender.letter_viewer.world.getItemAt(0)
            if (tiledImage.getFullyLoaded())
                sender.show_top_of_letter()
            else
                tiledImage.addOnceHandler('fully-loaded-change', function() { sender.show_top_of_letter() })
        })

        jQuery('.letter-thumbnail').each(function() {
            let thumb = jQuery(this)
            thumb.removeClass("current")
        })
        image.addClass("current")
        // Mirror the visual current state for assistive tech.
        jQuery('.letter-thumbnail-button').removeAttr('aria-current')
        image.closest('.letter-thumbnail-button').attr('aria-current', 'true')
        this.current_page = parseInt(index)
        let start_pb = this.highlight_page_text()

        if(scrollTextIntoView && start_pb) {
            let trans_div_y = sender.transcript_div.offset().top
            let trans_div_scroll = sender.transcript_div.scrollTop()
            let start_pb_y = start_pb.offset().top
            let top_padding = 10

            // scroll up
            if (start_pb_y < trans_div_y) {
                let amount = trans_div_y - start_pb_y
                sender.transcript_div.scrollTop(trans_div_scroll - (amount + top_padding))
            } else {
                let amount = start_pb_y - trans_div_y
                sender.transcript_div.scrollTop(trans_div_scroll + (amount - top_padding))
            }
        }
    }

    highlight_page_text() {
        let start_pb = null
        let end_pb = null
        let range = document.createRange()
        let textNodes = []

        if (this.pages_highlighted.length) {
            jQuery('.page-highlight.active').each(function() {
                jQuery(this).removeClass('active')
            })
        }

        let sender = this

        this.pbs.each(function() {
            let pb = jQuery(this)

            if (parseInt(pb.data('page')) === sender.current_page + 1) {
                start_pb = pb
            } else if (start_pb) {
                end_pb = pb
                return false
            }
        })
        if (!end_pb) end_pb = jQuery('#letter-stretcher')

        // No page-break marker for this page (e.g. a letter with no
        // transcription at all) — nothing to highlight or scroll to.
        if (!start_pb) return null

        if (this.pages_highlighted.includes(this.current_page)) {
            let highlights = jQuery(`.page-highlight.page-${this.current_page}`)
            highlights.each(function() {
                jQuery(this).addClass('active')
            })
        } else {
            range.setStart(start_pb[0], 0)
            range.setEnd(end_pb[0], 0)

            let rangeTextIterator = document.createNodeIterator(
                range.commonAncestorContainer,
                NodeFilter.SHOW_ALL,
                {
                    acceptNode: function (node) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            )

            while (rangeTextIterator.nextNode()) {
                if (!textNodes.length && rangeTextIterator.referenceNode !== range.startContainer) continue;
                textNodes.push(rangeTextIterator.referenceNode);
                if (rangeTextIterator.referenceNode === range.endContainer) break;
            }

            textNodes.forEach(node => {
                if (node.nodeType === 3 && range.intersectsNode(node)) {
                    let highlighter = document.createElement('span')
                    highlighter.className = 'page-highlight'
                    highlighter.classList.add('active')
                    highlighter.classList.add(`page-${this.current_page}`)
                    node.parentNode.insertBefore(highlighter, node)
                    highlighter.appendChild(node)
                }
            })

            this.pages_highlighted.push(this.current_page)
        }

        return start_pb
    }

    register_missing_image(image_no) {
        // Image missing - could implement fallback UI here
    }

    populate_entity_details(entity_tag, tooltip) {
        let ent_key = `${entity_tag.data('entity_type')}-${entity_tag.data('entity_id')}`
        if (ent_key in this.entities) {
            let ent = this.entities[ent_key]
            // Type modifier drives the label's color + icon (matches the
            // hover palette of the entity span that was clicked). <strong>,
            // not <label> — there's no form control here.
            let ent_type = escapeAttr(entity_tag.data('entity_type'))
            let content = `<strong class="entity-popup-label entity-popup-label--${ent_type}">${escapeHtml(ent.name)}</strong>`

            if (ent.uris && ent.uris.length) {
                content += `<div class="entity-popup-uris">`
                ent.uris.forEach(uri => {
                    content += `<a href="${escapeAttr(uri)}" target="_blank">${escapeHtml(uri)}</a><br />`
                })
                content += `</div>`
            }

            let search_url =`/letters/?${escapeAttr(entity_tag.data('entity_type'))}=${escapeAttr(entity_tag.data('entity_id'))}`
            content += `
                      <button type="button" onclick="window.open('${escapeAttr(search_url)}', '_blank')">
                        Show letters with this ${escapeHtml(entity_tag.data('entity_type').toLowerCase())}<span class="visually-hidden"> (opens in new tab)</span>
                      </button>
                `

            tooltip.setContent(content)
        }
    }
}


/**
 * Topic Index page (`/topic-index/?type=PERSON`).
 *
 * Renders a paginated, sortable list of all entities of one type — the same
 * data the homepage Browse-By tray used to dump inline. Each row links to the
 * advanced search pre-filtered by that entity (`/letters/?PERSON={xml_id}`),
 * matching the existing entity-popup link pattern in LetterViewer.
 *
 * Data: one aggregation request to /Letter/ for counts, one spooled Entity
 * fetch for display names. Same two-call shape the old Browser class used.
 * Sort + page-size + page are tracked in `criteria` and synced into the URL
 * via history.replaceState so back/forward and shareable links work.
 */
class TopicIndex {
    static VALID_TYPES = ['PERSON', 'PLACE', 'WORK', 'DATE', 'ORG']
    static TYPE_LABELS = {
        PERSON: MELP.text('label_person', 'People'),
        PLACE:  MELP.text('label_place', 'Places'),
        WORK:   MELP.text('label_work', 'Works'),
        DATE:   MELP.text('label_date', 'Date'),
        ORG:    MELP.text('label_org', 'Repository')
    }
    static VALID_SORTS = ['name_asc', 'name_desc', 'count_desc', 'count_asc']
    static VALID_PAGE_SIZES = [20, 50, 100]

    constructor(melp_instance) {
        this.melp = melp_instance

        // Normalize URL params into criteria; default + replaceState if missing/invalid.
        let url_params = this.melp.params.get
        let type      = (url_params.get('type') || '').toUpperCase()
        let sort      = url_params.get('sort') || 'name_asc'
        let page_size = parseInt(url_params.get('page_size'), 10)
        let page      = parseInt(url_params.get('page'), 10)

        if (!TopicIndex.VALID_TYPES.includes(type))            type = 'PERSON'
        if (!TopicIndex.VALID_SORTS.includes(sort))            sort = 'name_asc'
        if (!TopicIndex.VALID_PAGE_SIZES.includes(page_size))  page_size = 20
        if (!Number.isInteger(page) || page < 1)               page = 1

        this.criteria = { type, sort, page_size, page }
        this.entities = []           // cached merged [{xml_id, name, count}]
        this.cached_type = null      // type for which `entities` is populated

        let sort_box = jQuery('#topic-index-sort-box')
        let page_size_box = jQuery('#topic-index-page-size-box')

        sort_box.val(this.criteria.sort)
        page_size_box.val(String(this.criteria.page_size))

        let sender = this

        sort_box.change(function() {
            sender.criteria.sort = jQuery(this).val()
            sender.criteria.page = 1
            sender.sync_url()
            sender.render_page()
        })

        page_size_box.change(function() {
            sender.criteria.page_size = parseInt(jQuery(this).val(), 10)
            sender.criteria.page = 1
            sender.sync_url()
            sender.render_page()
        })

        jQuery('#topic-index-pagination').on('click', '.adv-search-page-link', function() {
            let link = jQuery(this)
            // `prop('disabled')` honors the real `disabled` attribute now
            // emitted by render_pagination; the `disabled` class is kept
            // as a fallback for any existing CSS that still selects it.
            if (link.prop('disabled') || link.hasClass('disabled') || link.hasClass('active')) return
            let target = parseInt(link.data('page'), 10)
            if (!target || target === sender.criteria.page) return
            sender.criteria.page = target
            sender.sync_url()
            sender.render_page()
            let top = jQuery('#topic-index-meta-bar').offset().top - 20
            if (MELP.prefers_reduced_motion()) jQuery('html, body').scrollTop(top)
            else jQuery('html, body').animate({ scrollTop: top }, 200)
        })

        this.render_header()
        this.sync_url()
        this.load_results()
    }

    render_header() {
        // The type label IS the page heading now (the old static "Topic
        // Index" h1 + separate subtitle were merged into one h1).
        let title = jQuery('#topic-index-title')
        let label = TopicIndex.TYPE_LABELS[this.criteria.type]
        title.text(label)
        // A11y: make the page <title> distinct per type (WCAG 2.4.2 A).
        // The static <title> from PHP is generic — overwrite here once
        // the active type is known. New title shape mirrors the visible
        // header: "<Type Label> — Topic Index — MELP".
        document.title = `${label} — Topic Index — MELP`
    }

    sync_url() {
        let params = new URLSearchParams()
        params.set('type', this.criteria.type)
        if (this.criteria.sort !== 'name_asc')   params.set('sort', this.criteria.sort)
        if (this.criteria.page_size !== 20)      params.set('page_size', String(this.criteria.page_size))
        if (this.criteria.page !== 1)            params.set('page', String(this.criteria.page))
        let new_url = `${window.location.pathname}?${params.toString()}`
        history.replaceState(null, '', new_url)
    }

    load_results() {
        let sender = this

        if (this.cached_type === this.criteria.type) {
            this.render_page()
            return
        }

        jQuery('#topic-index-results').html('<p style="padding:20px 0;color:var(--text-muted-color)">Loading…</p>')
        jQuery('#topic-index-pagination').empty()
        jQuery('#topic-index-count-bar').text('')

        // Step 1 — aggregations: count of letters per entity (and per author /
        // recipient for PERSON, per repo for ORG). Mirrors the old Browser.load_stats
        // shape so the same Corpora indexes are exercised.
        sender.melp.make_request(
            `/api/corpus/${sender.melp.corpus_id}/Letter/`,
            'GET',
            {
                'page-size': 0,
                'a_terms_index': 'entities_mentioned.xml_id,entities_mentioned.entity_type',
                'a_terms_author': 'author.xml_id',
                'a_terms_recipient': 'recipient.xml_id',
                'a_terms_repo': 'repository.id'
            },
            function(stat_aggs) {
                if (!(stat_aggs.meta && stat_aggs.meta.aggregations)) return

                let counts = {}    // xml_id -> count, for the active type only
                let aggs = stat_aggs.meta.aggregations
                let type = sender.criteria.type

                Object.keys(aggs.index || {}).forEach(key => {
                    let [xml_id, entity_type] = key.split('|||')
                    if (entity_type === type) counts[xml_id] = (counts[xml_id] || 0) + aggs.index[key]
                })

                if (type === 'PERSON') {
                    Object.keys(aggs.author || {}).forEach(key => {
                        counts[key] = (counts[key] || 0) + aggs.author[key]
                    })
                    Object.keys(aggs.recipient || {}).forEach(key => {
                        counts[key] = (counts[key] || 0) + aggs.recipient[key]
                    })
                } else if (type === 'ORG') {
                    Object.keys(aggs.repo || {}).forEach(key => {
                        counts[key] = (counts[key] || 0) + aggs.repo[key]
                    })
                }

                // Step 2 — spooled Entity fetch for display names. Matches the
                // page-size:1000 + spool pattern used elsewhere in melp.js.
                sender.melp.make_request(
                    `/api/corpus/${sender.melp.corpus_id}/Entity/`,
                    'GET',
                    {'page-size': 10000, 's_name': 'asc'},
                    function(ents) {
                        if (!ents.records) return
                        let merged = []
                        ents.records.forEach(ent => {
                            if (ent.entity_type !== type) return
                            // Some indexes key by xml_id (PERSON/PLACE/WORK/DATE),
                            // others by numeric id (ORG / some PERSONs). Try both.
                            let count = counts[ent.xml_id] !== undefined ? counts[ent.xml_id]
                                       : counts[ent.id]    !== undefined ? counts[ent.id]
                                       : 0
                            // Skip entities with zero mentions — they'd render as "(0)"
                            // and aren't actionable from the linked search.
                            if (count === 0) return
                            merged.push({
                                xml_id: ent.xml_id || ent.id,
                                name:   ent.name,
                                count:  count
                            })
                        })

                        sender.entities = merged
                        sender.cached_type = type
                        sender.render_page()
                    },
                    true,
                    true
                )
            }
        )
    }

    sorted_entities() {
        let arr = this.entities.slice()
        switch (this.criteria.sort) {
            case 'name_desc':  arr.sort((a, b) => b.name.localeCompare(a.name)); break
            case 'count_desc': arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)); break
            case 'count_asc':  arr.sort((a, b) => a.count - b.count || a.name.localeCompare(b.name)); break
            case 'name_asc':
            default:           arr.sort((a, b) => a.name.localeCompare(b.name))
        }
        return arr
    }

    render_page() {
        let results = jQuery('#topic-index-results')
        let count_bar = jQuery('#topic-index-count-bar')
        let sorted = this.sorted_entities()
        let total = sorted.length
        let page_size = this.criteria.page_size
        let total_pages = Math.max(1, Math.ceil(total / page_size))

        // Clamp page if a stale URL points past the end (e.g., after type change).
        if (this.criteria.page > total_pages) {
            this.criteria.page = total_pages
            this.sync_url()
        }

        let start = (this.criteria.page - 1) * page_size
        let slice = sorted.slice(start, start + page_size)
        let type = this.criteria.type

        count_bar.text(`${total} Result${total === 1 ? '' : 's'}`)

        results.empty()
        slice.forEach(ent => {
            results.append(`
                <a class="topic-index-row" href="/letters/?${escapeAttr(type)}=${escapeAttr(ent.xml_id)}">
                    <span class="topic-index-name">${escapeHtml(ent.name)}</span>
                    <span class="topic-index-count-badge">${ent.count}</span>
                </a>
            `)
        })

        if (slice.length === 0) {
            results.append(`<p style="padding:32px 0;color:var(--text-muted-color)">${escapeHtml(MELP.text('topic_index_no_results', 'No topics found for this type.'))}</p>`)
        }

        this.render_pagination(this.criteria.page, page_size, total)
    }

    /**
     * First / Prev / 1 / … / current ± 1 / … / last / Next labels per Figma.
     * Emits .adv-search-page-link buttons so they pick up the existing pager
     * button styling in _global.scss; the container is #topic-index-pagination
     * which has its own flex layout in _topic-index.scss.
     *
     * A11y: First/Prev/Next/Last buttons use HTML-entity arrows as their
     * only text — screen readers would announce "left double angle
     * quotation mark", so each gets an explicit `aria-label`. The
     * current page emits `aria-current="page"` so AT announces it as
     * the current item. Disabled buttons emit the real `disabled`
     * attribute, which makes them skip in tab order and announce as
     * unavailable; the `.disabled` class is also retained so the
     * existing CSS keeps working until _topic-index.scss is updated.
     */
    render_pagination(page, page_size, total) {
        let pagination = jQuery('#topic-index-pagination')
        pagination.empty()

        let total_pages = Math.max(1, Math.ceil(total / page_size))
        if (total <= page_size) return

        let nav_disabled    = page <= 1
        let nav_next_dis    = page >= total_pages

        // Sliding window of up to 5 consecutive page numbers, centered on the
        // current page and clamped to [1, total_pages] — no ellipsis, no
        // jumped-to last page. First/Last buttons handle the extremes.
        let window_size = 5
        let start = Math.max(1, Math.min(page - 2, total_pages - window_size + 1))
        let end = Math.min(total_pages, start + window_size - 1)
        let visible = []
        for (let p = start; p <= end; p++) visible.push(p)

        // tiny helper: render one nav button (First/Prev/Next/Last). Visible
        // word leads the accessible name (WCAG 2.5.3) — glyphs aria-hidden,
        // " page" suffix visually hidden.
        let navBtn = (text, target_page, disabled, pre_glyph, post_glyph) => {
            let cls = `adv-search-page-link${disabled ? ' disabled' : ''}`
            let disAttr = disabled ? ' disabled' : ''
            let pre = pre_glyph ? `<span aria-hidden="true">${pre_glyph} </span>` : ''
            let post = post_glyph ? `<span aria-hidden="true"> ${post_glyph}</span>` : ''
            return `<button type="button" class="${cls}" data-page="${target_page}"${disAttr}>${pre}${text}<span class="visually-hidden"> page</span>${post}</button>`
        }

        let html = ''
        html += navBtn('First', 1,          nav_disabled, '&laquo;', '')
        html += navBtn('Prev', page - 1, nav_disabled, '&lsaquo;', '')

        visible.forEach(p => {
            let is_active = p === page
            let active_cls = is_active ? ' active' : ''
            let aria_current = is_active ? ' aria-current="page"' : ''
            html += `<button type="button" class="adv-search-page-link${active_cls}" data-page="${p}"${aria_current} aria-label="Page ${p}">${p}</button>`
        })

        html += navBtn('Next', page + 1,      nav_next_dis, '', '&rsaquo;')
        html += navBtn('Last', total_pages,   nav_next_dis, '', '&raquo;')

        pagination.html(html)
    }
}

