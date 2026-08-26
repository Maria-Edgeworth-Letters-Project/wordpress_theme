<?php
/**
 * Understrap Child Theme functions and definitions
 *
 * @package understrap-child
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Define child theme version.
 */
define( 'UNDERSTRAP_CHILD_VERSION', '1.0.0' );

/**
 * Version string for a child-theme asset, based on the file's mtime so
 * browsers re-fetch whenever the file changes. A static version string
 * (e.g. UNDERSTRAP_CHILD_VERSION) lets browsers cache stale copies of
 * melp.js/style.css indefinitely. Falls back to the static version if the
 * file is missing.
 *
 * @param string $relative_path Path relative to the child theme root.
 * @return string Version string for wp_enqueue_*.
 */
function understrap_child_asset_version( $relative_path ) {
	$file = get_stylesheet_directory() . $relative_path;
	$mtime = file_exists( $file ) ? filemtime( $file ) : false;
	return $mtime ? (string) $mtime : UNDERSTRAP_CHILD_VERSION;
}

/**
 * Google Fonts stylesheet URL (Libre Baskerville + Public Sans).
 *
 * Enqueued rather than `@import`ed from style.css: an `@import` cannot start
 * downloading until style.css itself has been fetched and parsed, which
 * serializes two round trips before any text can render in the brand faces.
 */
const UNDERSTRAP_CHILD_GOOGLE_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Public+Sans:ital,wght@0,100..900;1,100..900&display=swap';

/**
 * Enqueue parent and child theme styles.
 *
 * All MELP styling lives in the child theme's `style.css`, hand-written in
 * native CSS (nesting, custom properties, nested @media). There is no build
 * step — edit that file directly. It replaced the former Gulp + Sass pipeline
 * that compiled `assets/scss/*.scss` into `assets/css/melp.css`.
 */
function understrap_child_enqueue_styles() {
	// Get parent theme version.
	$parent_theme = wp_get_theme( 'understrap' );

	// Google Fonts. No version string — the URL is already the cache key.
	wp_enqueue_style(
		'melp-google-fonts',
		UNDERSTRAP_CHILD_GOOGLE_FONTS_URL,
		array(),
		null
	);

	// Parent theme style.
	wp_enqueue_style(
		'understrap-styles',
		get_template_directory_uri() . '/css/theme.min.css',
		array(),
		$parent_theme->get( 'Version' )
	);

	// Child theme style — every MELP rule lives here.
	wp_enqueue_style(
		'understrap-child-styles',
		get_stylesheet_directory_uri() . '/style.css',
		array( 'understrap-styles' ),
		understrap_child_asset_version( '/style.css' )
	);
}
add_action( 'wp_enqueue_scripts', 'understrap_child_enqueue_styles' );

/**
 * Open the connections to the Google Fonts hosts during head parsing, so the
 * TLS handshakes overlap the stylesheet download instead of following it.
 * `fonts.gstatic.com` serves the font binaries and is cross-origin, hence the
 * crossorigin flag WordPress adds for `preconnect` hints.
 *
 * @param array  $urls          URLs to print for the given relation type.
 * @param string $relation_type The relation type the URLs are printed for.
 * @return array
 */
function understrap_child_google_fonts_resource_hints( $urls, $relation_type ) {
	if ( 'preconnect' === $relation_type && wp_style_is( 'melp-google-fonts', 'enqueued' ) ) {
		$urls[] = 'https://fonts.googleapis.com';
		$urls[] = array(
			'href' => 'https://fonts.gstatic.com',
			'crossorigin',
		);
	}
	return $urls;
}
add_filter( 'wp_resource_hints', 'understrap_child_google_fonts_resource_hints', 10, 2 );

/**
 * Dequeue plugin CSS and JS since they are now in the child theme.
 *
 *   - melp.css         → merged into the child theme's style.css
 *   - melp_mobile.css  → merged in as nested max-width: 799px rules
 *   - melp_tablet.css  → useful rules merged in; conflicting rules dropped
 *
 * The corresponding files in the plugin have been deleted; the dequeues keep
 * WordPress from emitting 404 references in case the plugin tries to register
 * them on a later request.
 *
 * Re-enqueue melp.js from the theme with the same dependencies.
 */
function understrap_child_dequeue_plugin_assets() {
	wp_dequeue_style( 'melp-css' );
	wp_deregister_style( 'melp-css' );

	wp_dequeue_style( 'melp-mobile-css' );
	wp_deregister_style( 'melp-mobile-css' );

	wp_dequeue_style( 'melp-tablet-css' );
	wp_deregister_style( 'melp-tablet-css' );

	wp_dequeue_script( 'melp-script' );
	wp_deregister_script( 'melp-script' );

	wp_enqueue_script(
		'melp-script',
		get_stylesheet_directory_uri() . '/assets/js/melp.js',
		array(
			'jquery',
			'jquery-mark',
			'melp-popper',
			'melp-tippy',
			'melp-select2',
			'melp-autocomplete',
			'melp-openseadragon',
			'melp-leaflet',
			'melp-leaflet-cluster',
		),
		understrap_child_asset_version( '/assets/js/melp.js' )
	);
}
add_action( 'wp_enqueue_scripts', 'understrap_child_dequeue_plugin_assets', 20 );

/**
 * Load MELP template parts.
 *
 * @param string $template_name The name of the template to load.
 */
function understrap_child_get_melp_template( $template_name ) {
	get_template_part( 'template-parts/melp/' . $template_name );
}

/**
 * Emit a "Skip to main content" link as the first focusable element on
 * every page. The link targets `#main-content`, which is supplied either
 * by `topic-index.php`'s `<main id="main-content">` or by the
 * `MELP` JS bootstrap's runtime wrap of Elementor pages (see
 * `assets/js/melp.js`).
 *
 * Styles live in `style.css` (`.skip-link`, TYPOGRAPHY section). The link
 * is hidden off-screen until focused, then drops into view at the top
 * left so keyboard users see and can activate it before tabbing through
 * the rest of the page.
 *
 * WCAG 2.4.1 A (Bypass Blocks), 2.4.7 AA (Focus Visible).
 */
function understrap_child_skip_link() {
	echo '<a class="skip-link" href="#main-content">Skip to main content</a>';
}
add_action( 'wp_body_open', 'understrap_child_skip_link', 1 );

/**
 * Inject the Ninja Form shortcode into the page footer so it renders
 * with all NF scripts. The JS will move it into #subscribe on load.
 */
function understrap_child_inject_ninja_form() {
	if ( ! is_front_page() ) {
		return;
	}
	echo '<div id="melp-ninja-form-holder" style="display:none;">';
	echo do_shortcode( '[ninja_form id=2]' );
	echo '</div>';
}
add_action( 'wp_footer', 'understrap_child_inject_ninja_form', 5 );

/**
 * Register MELP assets for use in JavaScript.
 */
function understrap_child_register_melp_assets() {
	wp_localize_script( 'melp-script', 'melpAssets', array(
		'filterIcon'     => esc_url( get_stylesheet_directory_uri() . '/assets/images/icon_filter.png' ),
		'hamburgerOpen'  => esc_url( get_stylesheet_directory_uri() . '/assets/images/icon_hamburger.png' ),
		'hamburgerClose' => esc_url( get_stylesheet_directory_uri() . '/assets/images/icon_hamburger_close.png' ),
		'themeUrl'       => esc_url( get_stylesheet_directory_uri() ),
	) );
}
add_action( 'wp_enqueue_scripts', 'understrap_child_register_melp_assets', 20 );

/**
 * Route `/topic-index/` to the theme template `topic-index.php` without
 * requiring a WordPress Page record.
 *
 * Three pieces work together:
 *   1. A rewrite rule maps `^topic-index/?$` → `is_topic_index=1`.
 *   2. `query_vars` whitelists `is_topic_index` so WP doesn't drop it.
 *   3. `template_include` swaps the rendering template to `topic-index.php`
 *      when the var is set, bypassing the Page hierarchy entirely.
 *
 * Rewrite rules are cached in the database; they're flushed automatically on
 * theme switch via `after_switch_theme`. For an in-place change (this file
 * was edited without re-activating the theme) run `wp rewrite flush` once.
 */
function understrap_child_add_topic_index_rewrite() {
	add_rewrite_rule(
		'^topic-index/?$',
		'index.php?is_topic_index=1',
		'top'
	);
}
add_action( 'init', 'understrap_child_add_topic_index_rewrite' );

function understrap_child_register_topic_index_query_var( $vars ) {
	$vars[] = 'is_topic_index';
	return $vars;
}
add_filter( 'query_vars', 'understrap_child_register_topic_index_query_var' );

function understrap_child_topic_index_template( $template ) {
	if ( intval( get_query_var( 'is_topic_index' ) ) === 1 ) {
		$custom = locate_template( 'topic-index.php' );
		if ( $custom ) {
			return $custom;
		}
	}
	return $template;
}
add_filter( 'template_include', 'understrap_child_topic_index_template' );

/**
 * Flush rewrite rules when the theme is activated so `/topic-index/` resolves
 * without a manual `wp rewrite flush` step on fresh installs.
 */
function understrap_child_flush_rewrites_on_theme_switch() {
	understrap_child_add_topic_index_rewrite();
	flush_rewrite_rules();
}
add_action( 'after_switch_theme', 'understrap_child_flush_rewrites_on_theme_switch' );

