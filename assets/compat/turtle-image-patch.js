/**
 * Conserved compatibility patch for legacy turtle image shape APIs.
 * Keep isolated from core runtime and enable only when explicitly needed.
 * @param {string[]} assetNames
 * @returns {string}
 */
export function buildTurtleImagePatchCode(assetNames = []) {
  const names = (assetNames || [])
    .map((name) => String(name || ""))
    .filter(Boolean);

  return `
import turtle
import sys

def _universal_reg(*args, **kwargs):
    try:
        name = None
        shape = None
        # Support both (name) and (self, name) or (name, shape) etc.
        for a in args:
            if isinstance(a, str):
                if name is None: name = a
            elif name is not None and shape is None:
                shape = a
        
        if 'name' in kwargs: name = kwargs['name']
        if 'shape' in kwargs: shape = kwargs['shape']
        
        if not isinstance(name, str) or not name or len(name) > 1000: return

        s = turtle.Screen()
        if not hasattr(s, '_shapes'): s._shapes = {}
        
        # Check if it's likely an image based on extension
        lower_name = name.lower()
        is_image = any(lower_name.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"])
        
        # Find the Shape class robustly
        ShapeClass = getattr(turtle, "Shape", None)
        if not ShapeClass and hasattr(s, '_shapes') and s._shapes:
            for val in s._shapes.values():
                if hasattr(val, '_type'):
                    ShapeClass = type(val)
                    break

        if ShapeClass:
            if shape is not None:
                s._shapes[name] = ShapeClass("polygon", shape)
            elif is_image or name not in (s.getshapes() if hasattr(s, 'getshapes') else []):
                s._shapes[name] = ShapeClass("image", name)
        else:
            s._shapes[name] = name
    except:
        pass

# --- Class Method Patches ---

# Patch Turtle.shape
_orig_t_shape = turtle.Turtle.shape
def _patched_t_shape(self, *args, **kwargs):
    try:
        name = None
        for a in args:
            if isinstance(a, str): name = a; break
        if name: _universal_reg(name)
    except: pass
    return _orig_t_shape(self, *args, **kwargs)
turtle.Turtle.shape = _patched_t_shape

# Patch Screen.addshape
turtle.Screen.addshape = _universal_reg
turtle.Screen.register_shape = _universal_reg

# Patch Screen.bgpic
_orig_s_bgpic = turtle.Screen.bgpic
def _patched_s_bgpic(self, *args, **kwargs):
    try:
        name = None
        for a in args:
            if isinstance(a, str): name = a; break
        if name and name != "nopic": _universal_reg(name)
    except: pass
    return _orig_s_bgpic(self, *args, **kwargs)
turtle.Screen.bgpic = _patched_s_bgpic

# --- Module Function Patches ---

# Patch turtle.addshape
turtle.addshape = _universal_reg
turtle.register_shape = _universal_reg

# Patch turtle.shape
_orig_mod_shape = turtle.shape
def _patched_mod_shape(*args, **kwargs):
    try:
        name = None
        for a in args:
            if isinstance(a, str): name = a; break
        if name: _universal_reg(name)
    except: pass
    return _orig_mod_shape(*args, **kwargs)
turtle.shape = _patched_mod_shape

# Patch turtle.bgpic
_orig_mod_bgpic = turtle.bgpic
def _patched_mod_bgpic(*args, **kwargs):
    try:
        name = None
        for a in args:
            if isinstance(a, str): name = a; break
        if name and name != "nopic": _universal_reg(name)
    except: pass
    return _orig_mod_bgpic(*args, **kwargs)
turtle.bgpic = _patched_mod_bgpic

# Pre-register assets
for n in ${JSON.stringify(names)}:
    _universal_reg(n)
`;
}
