<?php
/**
 * The template for displaying the footer
 *
 * @package understrap-child
 */

// Exit if accessed directly.
defined( 'ABSPATH' ) || exit;

$container = get_theme_mod( 'understrap_container_type' );

/**
 * Admin-editable site text (MELP plugin "Site Text" screen), with hardcoded
 * fallbacks in case the plugin is inactive. Same keys feed the JS footer
 * (template-parts/melp/footer.html) so both footers stay in sync.
 */
$melp_footer_text = function ( $key, $default ) {
	return function_exists( 'melp_get_site_text' ) ? melp_get_site_text( $key ) : $default;
};
$melp_supporters_url = $melp_footer_text( 'footer_supporters_url', '' );
?>

<?php get_template_part( 'sidebar-templates/sidebar', 'footerfull' ); ?>

<div class="melp-footer-floral">
	<img src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_floral.png' ); ?>" alt="">
</div>

<div class="wrapper" id="wrapper-footer">

	<div class="<?php echo esc_attr( $container ); ?>">

		<div class="row">

			<div class="col-md-12">

				<footer class="site-footer" id="colophon">

					<div id="footer-supported-by">
						<h2><?php echo esc_html( $melp_footer_text( 'footer_supported_by_heading', 'Supported By' ) ); ?></h2>
						<div id="footer-supported-by-list">
							<img class="footer-image" src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_NEH.png' ); ?>" alt="NEH">
							<img class="footer-image" src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_TAMU.png' ); ?>" alt="TAMU">
							<img class="footer-image" src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_UTKnox.png' ); ?>" alt="UT Knoxville">
							<img class="footer-image" src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_WFU.png' ); ?>" alt="WFU">
                            <img class="footer-image" src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_XULA.png' ); ?>" alt="XULA">
							<img class="footer-image" src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_SMU.png' ); ?>" alt="SMU">
						</div>
					</div>

					<?php if ( $melp_supporters_url ) : ?>
						<a id="footer-link" href="<?php echo esc_url( $melp_supporters_url ); ?>"><?php echo esc_html( $melp_footer_text( 'footer_supporters_label', 'View All Supporters' ) ); ?></a>
					<?php endif; ?>

					<div id="footer-copyright">
						<div id="footer-copyright-text">
							<?php echo esc_html( $melp_footer_text( 'footer_license_text', 'Text transcriptions and encoding are licensed under a Creative Commons Attribution 4.0 International License.' ) ); ?> | <a href="<?php echo esc_url( $melp_footer_text( 'footer_contact_url', 'mailto:mariaedgeworthletters@gmail.com' ) ); ?>"><?php echo esc_html( $melp_footer_text( 'footer_contact_label', 'Contact Us' ) ); ?></a>
						</div>

						<div id="footer-copyright-corpora">
							Powered by <img src="<?php echo esc_url( get_stylesheet_directory_uri() . '/assets/images/footer_corpora.png' ); ?>" alt="Corpora">
						</div>
					</div>

				</footer><!-- #colophon -->

			</div><!-- col -->

		</div><!-- .row -->

	</div><!-- .container(-fluid) -->

</div><!-- #wrapper-footer -->

<?php // Closing div#page from header.php. ?>
</div><!-- #page -->

<?php wp_footer(); ?>

</body>

</html>
