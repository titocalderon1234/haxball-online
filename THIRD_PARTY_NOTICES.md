# Third-party notices

## HaxballGym / `haxball_core`

`engine.js` is an independent JavaScript browser adaptation of concepts and
physics/state logic from the MIT-licensed HaxballGym `haxball_core` project.

MIT License

Copyright (c) 2026 Wazarr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## HaxBall compatibility/reference note

HaxBall is a separate game created by Mario Carbajal (basro). HB Local is an
independent project and is not affiliated with or endorsed by HaxBall or its
creator. No official HaxBall client source code or graphical assets are
included in this package.

## JSON5 / stadium-format note

The bundled user-supplied stadiums are strict-JSON `.hbs` files. HaxBall's public
stadium specification defines `.hbs` as JSON5; the current custom-file picker
accepts strict JSON and the bundled maps require no external parser or network.

## Team color presets

The `/partido` presets are hexadecimal team-color configurations inspired by
publicly shared HaxBall `/colors` community presets. They contain only color,
stripe-angle, and avatar-color data; no club/national-team logos, crests,
photos, or other graphical assets are bundled.
