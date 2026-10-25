const DeskModel = (function () {
  'use strict';

  var WIDTH = 10000;
  var HEIGHT = 10000;
  var MAX_BYTES = 10 * 1024 * 1024;
  var TOOLS = ['pen', 'eraser', 'line', 'rect', 'ellipse'];

  function fail(message) { throw new Error(message); }
  function plain(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('Neplatný objekt: ' + label + '.');
    Reflect.ownKeys(value).forEach(function (key) {
      if (typeof key !== 'string' || allowed.indexOf(key) < 0 || key === '__proto__' || key === 'prototype' || key === 'constructor') fail('Nepovolené pole v objekte: ' + label + '.');
      var descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('Neplatné pole v objekte: ' + label + '.');
    });
    return value;
  }
  function list(value, max, label) {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail('Neplatný alebo príliš dlhý zoznam: ' + label + '.');
    for (var i = 0; i < value.length; i++) {
      var descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('Zoznam ' + label + ' nesmie obsahovať prázdne ani vypočítavané položky.');
    }
    return value;
  }
  function number(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(label + ' musí byť číslo od ' + min + ' do ' + max + '.');
    return value;
  }
  function integer(value, min, max, label) {
    number(value, min, max, label);
    if (!Number.isSafeInteger(value)) fail(label + ' musí byť celé číslo.');
    return value;
  }
  function text(value, max, label) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(label + ' môže obsahovať najviac ' + max + ' znakov.');
    return value;
  }
  function color(value) {
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail('Farba musí mať tvar #RRGGBB.');
    return value;
  }
  function identifier(value, seen) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('Neplatný identifikátor položky na stole.');
    if (seen.has(value)) fail('Položky a ťahy na stole musia mať jedinečné identifikátory.');
    seen.add(value);
    return value;
  }
  function image(value) {
    if (typeof value !== 'string' || value.length > 2800000 || !/^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || value.slice(value.indexOf(',') + 1).length === 0) fail('Fotka musí byť PNG, JPEG alebo WEBP s veľkosťou približne do 2 MB.');
    return value;
  }
  function byteLength(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    var bytes = 0;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function createState() {
    return { version: 1, width: WIDTH, height: HEIGHT, background: '#000000', grid: { enabled: false, spacing: 24, style: 'dots', color: '#85744d', opacity: 0.15 }, strokes: [], items: [] };
  }
  function validateState(value, nested) {
    plain(value, nested ? ['version', 'width', 'height', 'background', 'grid', 'strokes', 'items'] : ['version', 'width', 'height', 'background', 'grid', 'strokes', 'items', 'canvases'], 'alchymistický stôl');
    if (value.version !== 1) fail('Táto verzia alchymistického stola nie je podporovaná.');
    if (!(value.width === WIDTH && value.height === HEIGHT) && !(value.width === 1800 && value.height === 1200)) fail('Plátno musí mať rozmery 10000 × 10000 alebo pôvodných 1800 × 1200.');
    var clean = createState();
    clean.width = value.width; clean.height = value.height;
    clean.background = color(value.background);
    if (value.grid !== undefined) {
      var grid = plain(value.grid, ['enabled', 'spacing', 'style', 'color', 'opacity'], 'mriežka');
      if (typeof grid.enabled !== 'boolean') fail('Zobrazenie mriežky musí byť zapnuté alebo vypnuté.');
      if (grid.style !== 'lines' && grid.style !== 'dots') fail('Mriežka môže mať čiary alebo bodky.');
      clean.grid = { enabled: grid.enabled, spacing: integer(grid.spacing, 10, 100, 'Rozostup mriežky'), style: grid.style, color: color(grid.color), opacity: number(grid.opacity, 0.05, 0.6, 'Viditeľnosť mriežky') };
    }
    var seen = new Set();
    var totalPoints = 0;
    clean.strokes = list(value.strokes, 2000, 'ťahy').map(function (stroke) {
      plain(stroke, ['id', 'tool', 'color', 'size', 'points'], 'ťah');
      var id = identifier(stroke.id, seen);
      if (TOOLS.indexOf(stroke.tool) < 0) fail('Neznámy nástroj na kreslenie.');
      var points = list(stroke.points, 100000, 'body ťahu');
      totalPoints += points.length;
      if (!points.length) fail('Každý ťah musí mať aspoň jeden bod.');
      if (totalPoints > 100000) fail('Plátno môže obsahovať najviac 100 000 bodov kresby.');
      return { id: id, tool: stroke.tool, color: color(stroke.color), size: number(stroke.size, 1, 60, 'Hrúbka ťahu'), points: points.map(function (point) {
        plain(point, ['x', 'y'], 'bod ťahu');
        return { x: number(point.x, 0, clean.width, 'Vodorovná poloha bodu'), y: number(point.y, 0, clean.height, 'Zvislá poloha bodu') };
      }) };
    });
    var notes = 0;
    var images = 0;
    clean.items = list(value.items, 120, 'lístky a fotky').map(function (item) {
      plain(item, ['id', 'type', 'x', 'y', 'width', 'height', 'z', 'color', 'text', 'src', 'name'], 'položka na stole');
      if (item.type !== 'note' && item.type !== 'image') fail('Na stôl možno pridať iba lístok alebo fotku.');
      plain(item, item.type === 'note' ? ['id', 'type', 'x', 'y', 'width', 'height', 'z', 'color', 'text'] : ['id', 'type', 'x', 'y', 'width', 'height', 'z', 'src', 'name'], 'položka na stole');
      var x = number(item.x, 0, clean.width, 'Vodorovná poloha položky');
      var y = number(item.y, 0, clean.height, 'Zvislá poloha položky');
      var width = number(item.width, 80, clean.width, 'Šírka položky');
      var height = number(item.height, 80, clean.height, 'Výška položky');
      if (x + width > clean.width || y + height > clean.height) fail('Celý lístok alebo fotka sa musí zmestiť na plátno.');
      var result = { id: identifier(item.id, seen), type: item.type, x: x, y: y, width: width, height: height, z: integer(item.z, 0, 100000, 'Poradie vrstvy') };
      if (item.type === 'note') {
        if (++notes > 100) fail('Na stole môže byť najviac 100 lístkov.');
        result.color = color(item.color);
        result.text = text(item.text, 5000, 'Text lístka');
      } else {
        if (++images > 20) fail('Na stole môže byť najviac 20 fotiek.');
        result.src = image(item.src);
        result.name = text(item.name, 160, 'Názov fotky');
      }
      return result;
    });
    if (!nested && value.canvases !== undefined) {
      var canvasIds = new Set(['main']);
      clean.canvases = list(value.canvases, 20, 'kanvasy').map(function (canvas) {
        plain(canvas, ['id', 'name', 'state'], 'kanvas');
        var name = text(canvas.name, 80, 'Názov kanvasu').trim();
        if (!name) fail('Kanvas musí mať názov.');
        return { id: identifier(canvas.id, canvasIds), name: name, state: validateState(canvas.state, true) };
      });
    }
    if (byteLength(JSON.stringify(clean)) > MAX_BYTES) fail('Alchymistický stôl a jeho kanvasy sú príliš veľké. Odstráň niektoré fotky alebo kresby, aby sa zmestili do 10 MB.');
    return clean;
  }
  return Object.freeze({ createState: createState, validateState: validateState });
})();
export default DeskModel;
