// Shared domain constants.

// The only valid product tags. "Custom" requires a custom description.
export const PRODUCT_TAGS = ['Tile', 'Corrugated', 'M25', 'M40', 'Custom'];

// Photo angles (lowercase = form field name, uppercase = stored value).
export const ANGLES = ['front', 'back', 'left', 'right'];

export const ANGLE_LABELS = {
  front: 'Front angle',
  back: 'Back angle',
  left: 'Left side angle',
  right: 'Right side angle',
};

export const PHOTO_KINDS = { PRODUCTION: 'PRODUCTION', INSTALLATION: 'INSTALLATION' };
