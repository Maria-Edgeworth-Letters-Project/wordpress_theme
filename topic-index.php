<?php
/**
 * Theme-level template for the Topic Index page.
 *
 * Served when functions.php's `template_include` filter detects the
 * `is_topic_index` query var (set by the rewrite rule registered alongside it).
 * No WordPress Page record is needed — the rewrite + filter pair maps
 * `/topic-index/` directly to this file so the editorial team doesn't have
 * to manage a page in the admin.
 *
 * Markup is intentionally minimal — the page is hydrated client-side by the
 * `TopicIndex` class in `assets/js/melp.js`, which mounts on
 * `#topic-index-container` and reads `?type=…&sort=…&page_size=…&page=…`.
 *
 * Why this template inlines the HTML skeleton instead of calling
 * get_header() / get_footer():
 *   - Understrap's header.php emits `<header id="wrapper-navbar">` and the
 *     child theme's footer.php emits `<div id="wrapper-footer">` with a fully
 *     hardcoded footer block. The MELP chrome we actually want comes from JS
 *     loading nav.html into `#top-container` and footer.html into
 *     `#footer-container` — those wrappers would render as a *second*,
 *     duplicate header and footer.
 *   - Elementor-built pages (homepage, /letters/, …) take the same approach:
 *     they skip get_header/get_footer entirely. This template matches that
 *     contract so the JS bootstrap is the single source of chrome.
 *
 * We still call wp_head() and wp_footer() so enqueued scripts/styles, the
 * admin bar, and any plugin hooks continue to work.
 *
 * @package understrap-child
 */

defined( 'ABSPATH' ) || exit;
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	<?php wp_head(); ?>
</head>

<body <?php body_class(); ?> <?php understrap_body_attributes(); ?>>
<?php do_action( 'wp_body_open' ); ?>

<?php /*
 * Three empty mount divs to feed the existing JS bootstrap in `assets/js/melp.js`:
 *
 *   - #top-container        → `melp.js` loads template-parts/melp/nav.html into it
 *                              (announcement banner, nav bar, masthead, hamburger).
 *   - #topic-index-container → `melp.js` loads template-parts/melp/topic_index.html
 *                              and instantiates the TopicIndex class.
 *   - #footer-container     → `melp.js` loads template-parts/melp/footer.html.
 */ ?>
<div id="top-container"></div>

<main id="main-content" class="site-main">
	<div id="topic-index-container"></div>
</main>

<div id="footer-container"></div>

<?php wp_footer(); ?>
</body>
</html>
