/* =========================================================
   MAHOUTO+ — Génération de certificat PDF (100% côté client)
   =========================================================
   Toujours généré dans le navigateur (jsPDF) — aucune nouvelle
   fonction Vercel, le projet reste à 12 (limite plan Hobby).

   IMPORTANT (25/09/2026) : le QR code était auparavant généré via
   une librairie externe chargée depuis un CDN (jsdelivr, puis un
   secours unpkg). En conditions réelles, les deux ont échoué sur le
   réseau/appareil de test. Le générateur QR est donc maintenant
   ENTIÈREMENT intégré dans ce fichier (voir MahoutoQrEncoder
   ci-dessous) — plus aucune requête réseau nécessaire pour le QR
   code, seulement pour jsPDF (qui garde ses deux CDN de secours).

   Nouveautés :
   - Logo officiel MAHOUTO+ (assets/logo-mahouto-plus.png — fichier
     EXISTANT du dépôt, jamais recréé/redessiné ici).
   - QR code généré localement, dessiné en rectangles vectoriels
     directement dans le PDF (plus net qu'une image à l'impression),
     pointant vers la page publique de vérification (verify.html).
   - Emplacement pour la signature du fondateur : assets/signature-
     fondateur.png. Si ce fichier n'existe pas encore, la signature
     graphique est simplement omise (repli propre sur le texte seul).
   ========================================================= */

window.MahoutoCertificatePdf = (function () {

  // =========================================================
  // Générateur QR code intégré (vendored, aucune dépendance réseau).
  // Algorithme original de Kazuhiko Arase (licence MIT), copié
  // depuis le dépôt source de Firefox (searchfox.org, third_party/
  // js/qrcode/qrcode.mjs — la même implémentation que des millions
  // de sites utilisent depuis 15 ans). Réduit aux seules fonctions
  // nécessaires à l'encodage d'un texte en mode "Byte" (notre usage :
  // une URL) — tout le code de rendu HTML/SVG/GIF d'origine (inutile
  // ici, on dessine nous-mêmes en rectangles) a été retiré pour
  // garder ce fichier léger.
  // =========================================================
  var MahoutoQrEncoder = (function () {
    var PAD0 = 0xEC, PAD1 = 0x11;

    var QRMode = { MODE_8BIT_BYTE: 1 << 2 };
    var QRErrorCorrectionLevel = { L: 1, M: 0, Q: 3, H: 2 };
    var QRMaskPattern = {
      PATTERN000: 0, PATTERN001: 1, PATTERN010: 2, PATTERN011: 3,
      PATTERN100: 4, PATTERN101: 5, PATTERN110: 6, PATTERN111: 7
    };

    var QRMath = (function () {
      var EXP_TABLE = new Array(256);
      var LOG_TABLE = new Array(256);
      for (var i = 0; i < 8; i += 1) EXP_TABLE[i] = 1 << i;
      for (var i = 8; i < 256; i += 1) {
        EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
      }
      for (var i = 0; i < 255; i += 1) LOG_TABLE[EXP_TABLE[i]] = i;
      return {
        glog: function (n) { if (n < 1) throw new Error("glog(" + n + ")"); return LOG_TABLE[n]; },
        gexp: function (n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP_TABLE[n]; }
      };
    })();

    var qrPolynomial = function (num, shift) {
      var offset = 0;
      while (offset < num.length && num[offset] === 0) offset += 1;
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];
      var self = {};
      self.getAt = function (index) { return _num[index]; };
      self.getLength = function () { return _num.length; };
      self.multiply = function (e) {
        var n = new Array(self.getLength() + e.getLength() - 1);
        for (var i = 0; i < self.getLength(); i += 1) {
          for (var j = 0; j < e.getLength(); j += 1) {
            n[i + j] ^= QRMath.gexp(QRMath.glog(self.getAt(i)) + QRMath.glog(e.getAt(j)));
          }
        }
        return qrPolynomial(n, 0);
      };
      self.mod = function (e) {
        if (self.getLength() - e.getLength() < 0) return self;
        var ratio = QRMath.glog(self.getAt(0)) - QRMath.glog(e.getAt(0));
        var n = new Array(self.getLength());
        for (var i = 0; i < self.getLength(); i += 1) n[i] = self.getAt(i);
        for (var i = 0; i < e.getLength(); i += 1) n[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
        return qrPolynomial(n, 0).mod(e);
      };
      return self;
    };

    var QRUtil = (function () {
      var PATTERN_POSITION_TABLE = [
        [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
        [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
        [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
        [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
        [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
        [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
        [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
        [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
        [6, 34, 62, 90, 118, 146],
        [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
        [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
        [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
      ];
      var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
      var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
      var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
      var self = {};
      var getBCHDigit = function (data) {
        var digit = 0;
        while (data !== 0) { digit += 1; data >>>= 1; }
        return digit;
      };
      self.getBCHTypeInfo = function (data) {
        var d = data << 10;
        while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15)));
        return ((data << 10) | d) ^ G15_MASK;
      };
      self.getBCHTypeNumber = function (data) {
        var d = data << 12;
        while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18)));
        return (data << 12) | d;
      };
      self.getPatternPosition = function (typeNumber) { return PATTERN_POSITION_TABLE[typeNumber - 1]; };
      self.getMaskFunction = function (maskPattern) {
        switch (maskPattern) {
          case QRMaskPattern.PATTERN000: return function (i, j) { return (i + j) % 2 === 0; };
          case QRMaskPattern.PATTERN001: return function (i, j) { return i % 2 === 0; };
          case QRMaskPattern.PATTERN010: return function (i, j) { return j % 3 === 0; };
          case QRMaskPattern.PATTERN011: return function (i, j) { return (i + j) % 3 === 0; };
          case QRMaskPattern.PATTERN100: return function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; };
          case QRMaskPattern.PATTERN101: return function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; };
          case QRMaskPattern.PATTERN110: return function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; };
          case QRMaskPattern.PATTERN111: return function (i, j) { return ((i * j) % 3 + (i + j) % 2) % 2 === 0; };
          default: throw new Error("bad maskPattern:" + maskPattern);
        }
      };
      self.getErrorCorrectPolynomial = function (errorCorrectLength) {
        var a = qrPolynomial([1], 0);
        for (var i = 0; i < errorCorrectLength; i += 1) a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
        return a;
      };
      self.getLengthInBits = function (mode, type) {
        if (1 <= type && type < 10) {
          switch (mode) {
            case QRMode.MODE_8BIT_BYTE: return 8;
            default: throw new Error("mode:" + mode);
          }
        } else if (type < 27) {
          switch (mode) {
            case QRMode.MODE_8BIT_BYTE: return 16;
            default: throw new Error("mode:" + mode);
          }
        } else if (type < 41) {
          switch (mode) {
            case QRMode.MODE_8BIT_BYTE: return 16;
            default: throw new Error("mode:" + mode);
          }
        } else {
          throw new Error("type:" + type);
        }
      };
      self.getLostPoint = function (qrcode) {
        var moduleCount = qrcode.getModuleCount();
        var lostPoint = 0;
        for (var row = 0; row < moduleCount; row += 1) {
          for (var col = 0; col < moduleCount; col += 1) {
            var sameCount = 0;
            var dark = qrcode.isDark(row, col);
            for (var r = -1; r <= 1; r += 1) {
              if (row + r < 0 || moduleCount <= row + r) continue;
              for (var c = -1; c <= 1; c += 1) {
                if (col + c < 0 || moduleCount <= col + c) continue;
                if (r === 0 && c === 0) continue;
                if (dark === qrcode.isDark(row + r, col + c)) sameCount += 1;
              }
            }
            if (sameCount > 5) lostPoint += (3 + sameCount - 5);
          }
        }
        for (var row = 0; row < moduleCount - 1; row += 1) {
          for (var col = 0; col < moduleCount - 1; col += 1) {
            var count = 0;
            if (qrcode.isDark(row, col)) count += 1;
            if (qrcode.isDark(row + 1, col)) count += 1;
            if (qrcode.isDark(row, col + 1)) count += 1;
            if (qrcode.isDark(row + 1, col + 1)) count += 1;
            if (count === 0 || count === 4) lostPoint += 3;
          }
        }
        for (var row = 0; row < moduleCount; row += 1) {
          for (var col = 0; col < moduleCount - 6; col += 1) {
            if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1) && qrcode.isDark(row, col + 2)
              && qrcode.isDark(row, col + 3) && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5)
              && qrcode.isDark(row, col + 6)) lostPoint += 40;
          }
        }
        for (var col = 0; col < moduleCount; col += 1) {
          for (var row = 0; row < moduleCount - 6; row += 1) {
            if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col) && qrcode.isDark(row + 2, col)
              && qrcode.isDark(row + 3, col) && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col)
              && qrcode.isDark(row + 6, col)) lostPoint += 40;
          }
        }
        var darkCount = 0;
        for (var col = 0; col < moduleCount; col += 1) {
          for (var row = 0; row < moduleCount; row += 1) {
            if (qrcode.isDark(row, col)) darkCount += 1;
          }
        }
        var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;
        return lostPoint;
      };
      return self;
    })();

    var QRRSBlock = (function () {
      var RS_BLOCK_TABLE = [
        [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
        [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
        [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
        [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
        [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
        [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
        [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
        [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
        [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
        [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
        [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
        [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
        [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
        [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
        [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
        [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
        [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
        [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
        [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
        [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
        [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
        [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
        [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
        [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
        [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
        [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
        [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
        [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
        [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
        [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
        [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
        [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
        [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
        [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
        [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
        [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
        [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
        [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
        [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
        [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16]
      ];
      var qrRSBlock = function (totalCount, dataCount) {
        return { totalCount: totalCount, dataCount: dataCount };
      };
      var self = {};
      var getRsBlockTable = function (typeNumber, ecl) {
        switch (ecl) {
          case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
          case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
          case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
          case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
          default: return undefined;
        }
      };
      self.getRSBlocks = function (typeNumber, ecl) {
        var rsBlock = getRsBlockTable(typeNumber, ecl);
        if (typeof rsBlock === "undefined") throw new Error("bad rs block @ typeNumber:" + typeNumber);
        var length = rsBlock.length / 3;
        var list = [];
        for (var i = 0; i < length; i += 1) {
          var count = rsBlock[i * 3 + 0];
          var totalCount = rsBlock[i * 3 + 1];
          var dataCount = rsBlock[i * 3 + 2];
          for (var j = 0; j < count; j += 1) list.push(qrRSBlock(totalCount, dataCount));
        }
        return list;
      };
      return self;
    })();

    var qrBitBuffer = function () {
      var _buffer = [];
      var _length = 0;
      var self = {};
      self.getBuffer = function () { return _buffer; };
      self.getLengthInBits = function () { return _length; };
      self.put = function (num, length) {
        for (var i = 0; i < length; i += 1) self.putBit(((num >>> (length - i - 1)) & 1) === 1);
      };
      self.putBit = function (bit) {
        var bufIndex = Math.floor(_length / 8);
        if (_buffer.length <= bufIndex) _buffer.push(0);
        if (bit) _buffer[bufIndex] |= (0x80 >>> (_length % 8));
        _length += 1;
      };
      return self;
    };

    var qr8BitByte = function (data, stringToBytesFn) {
      var _mode = QRMode.MODE_8BIT_BYTE;
      var _bytes = stringToBytesFn(data);
      return {
        getMode: function () { return _mode; },
        getLength: function () { return _bytes.length; },
        write: function (buffer) { for (var i = 0; i < _bytes.length; i += 1) buffer.put(_bytes[i], 8); }
      };
    };

    var stringToBytes = function (s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) bytes.push(s.charCodeAt(i) & 0xff);
      return bytes;
    };

    // qrcode(typeNumber, errorCorrectionLevel) — typeNumber 0 = auto.
    var qrcode = function (typeNumber, errorCorrectionLevel) {
      var PAD0_ = PAD0, PAD1_ = PAD1;
      var _typeNumber = typeNumber;
      var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
      var _modules = null;
      var _moduleCount = 0;
      var _dataCache = null;
      var _dataList = [];
      var self = {};

      var setupPositionProbePattern = function (row, col) {
        for (var r = -1; r <= 7; r += 1) {
          if (row + r <= -1 || _moduleCount <= row + r) continue;
          for (var c = -1; c <= 7; c += 1) {
            if (col + c <= -1 || _moduleCount <= col + c) continue;
            if ((0 <= r && r <= 6 && (c === 0 || c === 6))
              || (0 <= c && c <= 6 && (r === 0 || r === 6))
              || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      };

      var getBestMaskPattern = function () {
        var minLostPoint = 0, pattern = 0;
        for (var i = 0; i < 8; i += 1) {
          makeImpl(true, i);
          var lostPoint = QRUtil.getLostPoint(self);
          if (i === 0 || minLostPoint > lostPoint) { minLostPoint = lostPoint; pattern = i; }
        }
        return pattern;
      };

      var setupTimingPattern = function () {
        for (var r = 8; r < _moduleCount - 8; r += 1) {
          if (_modules[r][6] != null) continue;
          _modules[r][6] = (r % 2 === 0);
        }
        for (var c = 8; c < _moduleCount - 8; c += 1) {
          if (_modules[6][c] != null) continue;
          _modules[6][c] = (c % 2 === 0);
        }
      };

      var setupPositionAdjustPattern = function () {
        var pos = QRUtil.getPatternPosition(_typeNumber);
        for (var i = 0; i < pos.length; i += 1) {
          for (var j = 0; j < pos.length; j += 1) {
            var row = pos[i], col = pos[j];
            if (_modules[row][col] != null) continue;
            for (var r = -2; r <= 2; r += 1) {
              for (var c = -2; c <= 2; c += 1) {
                if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
                  _modules[row + r][col + c] = true;
                } else {
                  _modules[row + r][col + c] = false;
                }
              }
            }
          }
        }
      };

      var setupTypeNumber = function (test) {
        var bits = QRUtil.getBCHTypeNumber(_typeNumber);
        for (var i = 0; i < 18; i += 1) {
          var mod = (!test && ((bits >> i) & 1) === 1);
          _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
        }
        for (var i = 0; i < 18; i += 1) {
          var mod = (!test && ((bits >> i) & 1) === 1);
          _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
        }
      };

      var setupTypeInfo = function (test, maskPattern) {
        var data = (_errorCorrectionLevel << 3) | maskPattern;
        var bits = QRUtil.getBCHTypeInfo(data);
        for (var i = 0; i < 15; i += 1) {
          var mod = (!test && ((bits >> i) & 1) === 1);
          if (i < 6) _modules[i][8] = mod;
          else if (i < 8) _modules[i + 1][8] = mod;
          else _modules[_moduleCount - 15 + i][8] = mod;
        }
        for (var i = 0; i < 15; i += 1) {
          var mod = (!test && ((bits >> i) & 1) === 1);
          if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
          else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
          else _modules[8][15 - i - 1] = mod;
        }
        _modules[_moduleCount - 8][8] = (!test);
      };

      var mapData = function (data, maskPattern) {
        var inc = -1, row = _moduleCount - 1, bitIndex = 7, byteIndex = 0;
        var maskFunc = QRUtil.getMaskFunction(maskPattern);
        for (var col = _moduleCount - 1; col > 0; col -= 2) {
          if (col === 6) col -= 1;
          while (true) {
            for (var c = 0; c < 2; c += 1) {
              if (_modules[row][col - c] == null) {
                var dark = false;
                if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
                var mask = maskFunc(row, col - c);
                if (mask) dark = !dark;
                _modules[row][col - c] = dark;
                bitIndex -= 1;
                if (bitIndex === -1) { byteIndex += 1; bitIndex = 7; }
              }
            }
            row += inc;
            if (row < 0 || _moduleCount <= row) { row -= inc; inc = -inc; break; }
          }
        }
      };

      var createBytes = function (buffer, rsBlocks) {
        var offset = 0, maxDcCount = 0, maxEcCount = 0;
        var dcdata = new Array(rsBlocks.length);
        var ecdata = new Array(rsBlocks.length);
        for (var r = 0; r < rsBlocks.length; r += 1) {
          var dcCount = rsBlocks[r].dataCount;
          var ecCount = rsBlocks[r].totalCount - dcCount;
          maxDcCount = Math.max(maxDcCount, dcCount);
          maxEcCount = Math.max(maxEcCount, ecCount);
          dcdata[r] = new Array(dcCount);
          for (var i = 0; i < dcdata[r].length; i += 1) dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
          offset += dcCount;
          var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
          var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
          var modPoly = rawPoly.mod(rsPoly);
          ecdata[r] = new Array(rsPoly.getLength() - 1);
          for (var i = 0; i < ecdata[r].length; i += 1) {
            var modIndex = i + modPoly.getLength() - ecdata[r].length;
            ecdata[r][i] = (modIndex >= 0) ? modPoly.getAt(modIndex) : 0;
          }
        }
        var totalCodeCount = 0;
        for (var i = 0; i < rsBlocks.length; i += 1) totalCodeCount += rsBlocks[i].totalCount;
        var data = new Array(totalCodeCount);
        var index = 0;
        for (var i = 0; i < maxDcCount; i += 1) {
          for (var r = 0; r < rsBlocks.length; r += 1) {
            if (i < dcdata[r].length) { data[index] = dcdata[r][i]; index += 1; }
          }
        }
        for (var i = 0; i < maxEcCount; i += 1) {
          for (var r = 0; r < rsBlocks.length; r += 1) {
            if (i < ecdata[r].length) { data[index] = ecdata[r][i]; index += 1; }
          }
        }
        return data;
      };

      var createData = function (typeNumber, ecl, dataList) {
        var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, ecl);
        var buffer = qrBitBuffer();
        for (var i = 0; i < dataList.length; i += 1) {
          var data = dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
          data.write(buffer);
        }
        var totalDataCount = 0;
        for (var i = 0; i < rsBlocks.length; i += 1) totalDataCount += rsBlocks[i].dataCount;
        if (buffer.getLengthInBits() > totalDataCount * 8) {
          throw new Error("code length overflow.");
        }
        if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
        while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
        while (true) {
          if (buffer.getLengthInBits() >= totalDataCount * 8) break;
          buffer.put(PAD0_, 8);
          if (buffer.getLengthInBits() >= totalDataCount * 8) break;
          buffer.put(PAD1_, 8);
        }
        return createBytes(buffer, rsBlocks);
      };

      var makeImpl = function (test, maskPattern) {
        _moduleCount = _typeNumber * 4 + 17;
        _modules = (function (moduleCount) {
          var modules = new Array(moduleCount);
          for (var row = 0; row < moduleCount; row += 1) {
            modules[row] = new Array(moduleCount);
            for (var col = 0; col < moduleCount; col += 1) modules[row][col] = null;
          }
          return modules;
        })(_moduleCount);
        setupPositionProbePattern(0, 0);
        setupPositionProbePattern(_moduleCount - 7, 0);
        setupPositionProbePattern(0, _moduleCount - 7);
        setupPositionAdjustPattern();
        setupTimingPattern();
        setupTypeInfo(test, maskPattern);
        if (_typeNumber >= 7) setupTypeNumber(test);
        if (_dataCache == null) _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
        mapData(_dataCache, maskPattern);
      };

      self.addData = function (data) {
        _dataList.push(qr8BitByte(data, stringToBytes));
        _dataCache = null;
      };
      self.isDark = function (row, col) {
        if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) throw new Error(row + "," + col);
        return _modules[row][col];
      };
      self.getModuleCount = function () { return _moduleCount; };
      self.make = function () {
        if (_typeNumber < 1) {
          var typeNumber = 1;
          for (; typeNumber < 40; typeNumber += 1) {
            var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
            var buffer = qrBitBuffer();
            for (var i = 0; i < _dataList.length; i += 1) {
              var data = _dataList[i];
              buffer.put(data.getMode(), 4);
              buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
              data.write(buffer);
            }
            var totalDataCount = 0;
            for (var i = 0; i < rsBlocks.length; i += 1) totalDataCount += rsBlocks[i].dataCount;
            if (buffer.getLengthInBits() <= totalDataCount * 8) break;
          }
          _typeNumber = typeNumber;
        }
        makeImpl(false, getBestMaskPattern());
      };
      return self;
    };

    return qrcode;
  })();

  // Encode `text` et renvoie { count, isDark(r,c) } — prêt à dessiner.
  function generateQrMatrix(text) {
    var qr = MahoutoQrEncoder(0, "M"); // 0 = version auto-sélectionnée ; M = correction d'erreur équilibrée
    qr.addData(text);
    qr.make();
    return qr;
  }

  // Dessine le QR directement en rectangles vectoriels dans le PDF —
  // net à l'impression, aucune image/canvas nécessaire.
  function drawQrCode(doc, text, x, y, sizeMm, colorRgb) {
    var qr = generateQrMatrix(text);
    var count = qr.getModuleCount();
    var cell = sizeMm / count;
    doc.setFillColor(colorRgb[0], colorRgb[1], colorRgb[2]);
    for (var r = 0; r < count; r += 1) {
      for (var c = 0; c < count; c += 1) {
        if (qr.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell, cell, "F");
      }
    }
  }
  // =========================================================
  // Fin du générateur QR intégré.
  // =========================================================

  var jsPDFLoaded = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Impossible de charger " + src));
      document.head.appendChild(script);
    });
  }

  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jsPDFLoaded) return jsPDFLoaded;
    jsPDFLoaded = loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
      .catch(() => loadScript("https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js"));
    return jsPDFLoaded;
  }

  // Charge une image (même origine) et la renvoie en data URL PNG,
  // avec ses dimensions naturelles pour préserver le ratio et ne
  // jamais déformer le logo ou la signature.
  function loadImageAsDataUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        try {
          resolve({ dataUrl: canvas.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("Image introuvable : " + url));
      img.src = url;
    });
  }

  // Identique, mais l'image est déjà éclaircie/rendue transparente au
  // moment du dessin sur le canvas (ctx.globalAlpha, une API Canvas
  // standard et fiable) — utilisé pour le filigrane, plutôt que de
  // dépendre d'une fonctionnalité de transparence propre à jsPDF
  // (GState) dont la syntaxe exacte n'est pas garantie selon la
  // version/le CDN chargé.
  function loadImageAsDataUrlWithOpacity(url, opacity) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.globalAlpha = opacity;
        ctx.drawImage(img, 0, 0);
        try {
          resolve({ dataUrl: canvas.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error("Image introuvable : " + url));
      img.src = url;
    });
  }

  function spaced(text) {
    return String(text || "").split("").join("\u2009");
  }

  // Convertit un ArrayBuffer en base64, par blocs pour éviter tout
  // dépassement de pile sur un fichier de police de plusieurs dizaines
  // de Ko (String.fromCharCode.apply sur un très grand tableau peut
  // planter d'un coup si on ne découpe pas).
  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  let scriptFontBase64 = null;

  // Charge la police manuscrite (assets/grand-hotel.ttf,
  // fichier fourni par l'utilisateur — jamais générée/inventée ici).
  // Le FICHIER n'est téléchargé qu'une fois (mis en cache en mémoire),
  // mais il doit être enregistré séparément sur CHAQUE document PDF —
  // jsPDF ne partage pas les polices entre deux instances différentes,
  // et un nouveau document jsPDF est créé à chaque certificat généré.
  // En cas d'échec (réseau, fichier absent), le nom du bénéficiaire
  // retombe simplement sur Times italique — jamais d'erreur bloquante.
  async function loadScriptFont(doc) {
    if (!scriptFontBase64) {
      const resp = await fetch("assets/grand-hotel.ttf");
      if (!resp.ok) throw new Error("Police introuvable (" + resp.status + ")");
      const buffer = await resp.arrayBuffer();
      scriptFontBase64 = arrayBufferToBase64(buffer);
    }
    doc.addFileToVFS("GrandHotel-Regular.ttf", scriptFontBase64);
    doc.addFont("GrandHotel-Regular.ttf", "GrandHotel", "normal");
  }

  // Place une image en la faisant tenir dans une boîte maxW x maxH
  // (mm), centrée horizontalement autour de cx, sans jamais déformer
  // le ratio d'origine.
  function drawImageFit(doc, img, cx, y, maxW, maxH) {
    const ratio = img.width / img.height;
    let w = maxW, h = maxW / ratio;
    if (h > maxH) { h = maxH; w = maxH * ratio; }
    doc.addImage(img.dataUrl, "PNG", cx - w / 2, y, w, h);
    return h;
  }

  // -------- Éléments décoratifs (approximations vectorielles — voir
  // le message accompagnant cette livraison pour ce qui reste une
  // simplification par rapport au modèle fourni) --------

  // Branche de laurier simplifiée : une tige courbe avec quelques
  // "feuilles" ovales. mirror=true la dessine inversée (miroir).
  function drawLaurel(doc, x, y, mirror, color) {
    const s = mirror ? -1 : 1;
    doc.setFillColor(...color);
    doc.setDrawColor(...color);
    for (let i = 0; i < 6; i += 1) {
      const t = i / 5;
      const lx = x + s * (6 + t * 16);
      const ly = y - t * 22;
      const angle = mirror ? 200 - t * 40 : -20 + t * 40;
      doc.ellipse(lx, ly, 3.2 - t * 1.2, 1.3, "F");
    }
  }

  // Bandeau diagonal décoratif dans un coin (vert + liseré doré),
  // avec une petite pointe façon "drapeau replié" — approximation du
  // bandeau ornemental du modèle (sans le motif géométrique intérieur,
  // trop complexe à reproduire fidèlement en vectoriel à la main).
  function drawCornerRibbon(doc, pageW, pageH, corner, green, gold, label) {
    const size = 62;
    doc.saveGraphicsState ? null : null;
    if (corner === "tl") {
      doc.setFillColor(...green);
      doc.triangle(0, 0, size, 0, 0, size, "F");
      doc.setDrawColor(...gold);
      doc.setLineWidth(1);
      doc.line(0, size, size, 0);
      if (label) {
        // Texte HORIZONTAL, non pivoté, tassé près du coin (0,0) —
        // fiable quel que soit le sens réel de rotation de jsPDF (deux
        // tentatives précédentes avec un texte à 45° ont mal tourné,
        // signe que je ne maîtrisais pas assez précisément cette API
        // pour continuer à deviner). Une largeur maximale sûre est
        // mesurée avec doc.getTextWidth() avant de dessiner.
        const labelX = 6, labelY = 14;
        const maxWidth = 34; // marge de sécurité réelle : à y=14, la limite du triangle (x+y≤62) autorise jusqu'à x=48
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        let labelSize = 7;
        while (labelSize > 3) {
          doc.setFontSize(labelSize);
          if (doc.getTextWidth(label) <= maxWidth) break;
          labelSize -= 0.2;
        }
        doc.setFontSize(labelSize);
        doc.text(label, labelX, labelY);
      }
    } else {
      doc.setFillColor(...green);
      doc.triangle(pageW, pageH, pageW - size, pageH, pageW, pageH - size, "F");
      doc.setDrawColor(...gold);
      doc.setLineWidth(1);
      doc.line(pageW - size, pageH, pageW, pageH - size);
    }
  }

  // Bandeau/banderole (pointes aux deux extrémités) contenant le nom
  // de la formation — reproduit fidèlement la forme du modèle.
  function drawBanner(doc, cx, y, w, h, fill, border, text, textColor) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const point = h * 0.55;
    doc.setFillColor(...fill);
    doc.setDrawColor(...border);
    doc.setLineWidth(0.6);
    // Le tracé part de la POINTE gauche (x0, y) — le vecteur du 1er
    // segment monte déjà de h/2, donc le point de départ doit être au
    // centre vertical, pas déjà décalé vers le haut (c'était le bug :
    // toute la forme se dessinait 6 mm au-dessus du texte).
    doc.lines(
      [[point, -h / 2], [w - 2 * point, 0], [point, h / 2], [-point, h / 2], [-(w - 2 * point), 0], [-point, -h / 2]],
      x0, y, [1, 1], "FD", true
    );
    doc.setTextColor(...textColor);
    doc.setFont("times", "bold");
    doc.setFontSize(15);
    doc.text(text, cx, y + 1.8, { align: "center" });
  }

  // Petit badge carré coloré avec une icône vectorielle simplifiée
  // (calendrier ou carte) — remplace une icône emoji, non fiable dans
  // les polices de base de jsPDF.
  function drawIconBadge(doc, x, y, size, kind, badgeColor) {
    doc.setFillColor(...badgeColor);
    doc.roundedRect(x, y, size, size, 1.2, 1.2, "F");
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.35);
    if (kind === "calendar") {
      doc.rect(x + size * 0.2, y + size * 0.28, size * 0.6, size * 0.5);
      doc.line(x + size * 0.32, y + size * 0.18, x + size * 0.32, y + size * 0.32);
      doc.line(x + size * 0.68, y + size * 0.18, x + size * 0.68, y + size * 0.32);
    } else {
      doc.roundedRect(x + size * 0.2, y + size * 0.25, size * 0.6, size * 0.5, 0.8, 0.8);
      doc.circle(x + size * 0.38, y + size * 0.42, size * 0.08);
      doc.line(x + size * 0.55, y + size * 0.42, x + size * 0.72, y + size * 0.42);
      doc.line(x + size * 0.3, y + size * 0.6, x + size * 0.62, y + size * 0.6);
    }
  }

  // certificate = { userName, formationTitle, issuedAt (ISO string), code }
  async function download(certificate) {
    await loadJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const cx = pageW / 2;

    // Palette reprise du modèle fourni (vert forêt + or), à la place
    // de l'ancienne palette navy/or.
    const green = [13, 58, 41];
    const gold = [197, 160, 60];
    const goldDark = [150, 118, 35];
    const ink = [22, 34, 27];
    const muted = [95, 105, 97];
    const ivory = [253, 251, 244];
    const white = [255, 255, 255];

    // -------- Fond --------
    doc.setFillColor(...ivory);
    doc.rect(0, 0, pageW, pageH, "F");

    // -------- Filigrane logo (très pâle, à droite) — dessiné en
    // premier pour rester DERRIÈRE tout le reste. --------
    try {
      const logoWm = await loadImageAsDataUrlWithOpacity("assets/logo-mahouto-plus.png", 0.06);
      drawImageFit(doc, logoWm, pageW - 70, 40, 130, 130);
    } catch (err) {
      console.warn("[CERTIFICAT] filigrane non affiché :", err.message);
    }

    // -------- Cadre ornemental --------
    doc.setDrawColor(...gold);
    doc.setLineWidth(1);
    doc.rect(9, 9, pageW - 18, pageH - 18);
    doc.setLineWidth(0.3);
    doc.rect(13, 13, pageW - 26, pageH - 26);
    function cornerMark(x, y, sx, sy) {
      doc.setDrawColor(...gold);
      doc.setLineWidth(0.6);
      doc.line(x, y, x + 14 * sx, y);
      doc.line(x, y, x, y + 14 * sy);
    }
    cornerMark(13, 13, 1, 1);
    cornerMark(pageW - 13, 13, -1, 1);
    cornerMark(13, pageH - 13, 1, -1);
    cornerMark(pageW - 13, pageH - 13, -1, -1);

    // Bandeaux diagonaux (approximation — voir message d'accompagnement
    // pour la limite sur le motif géométrique intérieur, non reproduit).
    drawCornerRibbon(doc, pageW, pageH, "tl", green, gold, "ÉCOSYSTÈME MAHOUTO+");
    drawCornerRibbon(doc, pageW, pageH, "br", green, gold, null);

    // -------- Logo officiel MAHOUTO+ (fichier existant du dépôt) --------
    try {
      const logo = await loadImageAsDataUrl("assets/logo-mahouto-plus.png");
      drawImageFit(doc, logo, cx, 11, 24, 20);
    } catch (err) {
      console.warn("[CERTIFICAT] logo introuvable, poursuite sans logo :", err.message);
    }

    // -------- Bandeau slogan (haut droite) --------
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.3);
    doc.line(pageW - 82, 13, pageW - 82, 28);
    doc.setTextColor(...ink);
    doc.setFont("times", "normal");
    doc.setFontSize(9.5);
    doc.text("Construire l'Afrique", pageW - 18, 18, { align: "right" });
    doc.text("numérique de demain.", pageW - 18, 24, { align: "right" });

    // -------- Titre (centré sur la page) — Helvetica gras, avec un
    // léger effet de "double trait" pour paraître plus épais que le
    // nom du bénéficiaire, comme demandé. jsPDF n'a pas de graisse
    // "black"/"extra-bold" au-delà de "bold" pour les polices de
    // base, donc on simule le supplément de poids en dessinant le
    // texte deux fois avec un minuscule décalage. --------
    doc.setTextColor(...green);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(21);
    const titleText = spaced("CERTIFICAT DE RÉUSSITE");
    doc.text(titleText, cx + 0.18, 44, { align: "center" });
    doc.text(titleText, cx, 44, { align: "center" });
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.4);
    doc.line(cx - 32, 49, cx + 32, 49);
    doc.setFillColor(...gold);
    doc.circle(cx, 49, 0.8, "F");

    // -------- Corps --------
    doc.setTextColor(...ink);
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    doc.text("Décerné à", cx, 59, { align: "center" });
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.3);
    doc.line(cx - 34, 59.5, cx - 12, 59.5);
    doc.line(cx + 12, 59.5, cx + 34, 59.5);

    // Nom du bénéficiaire — Helvetica gras (l'équivalent Arial déjà
    // intégré à jsPDF, aucun fichier de police à charger).
    const nameText = certificate.userName || "—";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.setTextColor(...green);
    doc.text(nameText, cx, 73, { align: "center" });
    const nameWidth = doc.getTextWidth(nameText);
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.5);
    doc.line(cx - nameWidth / 2 - 4, 77, cx + nameWidth / 2 + 4, 77);

    doc.setTextColor(...ink);
    doc.setFont("times", "normal");
    doc.setFontSize(11.5);
    doc.text("Pour avoir suivi et validé avec succès la formation", cx, 86, { align: "center" });

    // -------- Bandeau formation (banderole) --------
    const formationTitle = certificate.formationTitle || "—";
    const bannerW = Math.min(200, doc.getTextWidth(formationTitle) * 1.6 + 40);
    drawBanner(doc, cx, 99, bannerW, 12, green, gold, formationTitle, white);

    // -------- Date / Code --------
    const dateStr = certificate.issuedAt
      ? new Date(certificate.issuedAt).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" })
      : "";
    const rowY = 113;
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.3);
    doc.line(cx, rowY - 6, cx, rowY + 6);

    drawIconBadge(doc, cx - 70, rowY - 4, 8, "calendar", gold);
    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    doc.text("Date d'obtention :", cx - 59, rowY - 1);
    doc.setTextColor(...ink);
    doc.setFont("times", "bold");
    doc.setFontSize(10.5);
    doc.text(dateStr, cx - 59, rowY + 4.5);

    drawIconBadge(doc, cx + 10, rowY - 4, 8, "id", gold);
    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    doc.text("Code du certificat :", cx + 21, rowY - 1);
    doc.setTextColor(...ink);
    doc.setFont("times", "bold");
    doc.setFontSize(10.5);
    doc.text(certificate.code || "", cx + 21, rowY + 4.5);

    // -------- QR code (bas gauche) — généré localement, pointe vers
    // la vraie page de vérification publique. --------
    const qrY = 132;
    const qrSize = 24;
    const qrX = 42;
    const verifyUrl = window.location.origin + "/verify/" + encodeURIComponent(certificate.code || "");
    try {
      console.log("[CERTIFICAT] génération QR (local, sans réseau) pour :", verifyUrl);
      drawQrCode(doc, verifyUrl, qrX - qrSize / 2, qrY, qrSize, ink);
      console.log("[CERTIFICAT] QR code inséré avec succès");
    } catch (err) {
      console.error("[CERTIFICAT] QR code NON généré :", err);
    }
    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(8);
    doc.text("Scannez ce QR code pour vérifier", qrX - qrSize / 2, qrY + qrSize + 6);
    doc.text("l'authenticité de ce certificat", qrX - qrSize / 2, qrY + qrSize + 10.5);
    doc.setFontSize(7);
    doc.setTextColor(...green);
    doc.text(verifyUrl, qrX - qrSize / 2, qrY + qrSize + 15.5);

    // -------- Sceau médaille (centre bas) — vrai logo + ruban vert --------
    const sealX = cx, sealY = 146;
    doc.setFillColor(...gold);
    doc.triangle(sealX - 7, sealY + 5, sealX - 1, sealY + 20, sealX - 10, sealY + 16, "F");
    doc.triangle(sealX + 7, sealY + 5, sealX + 1, sealY + 20, sealX + 10, sealY + 16, "F");
    doc.setFillColor(...green);
    doc.triangle(sealX - 6, sealY + 6, sealX - 1.5, sealY + 19, sealX - 8.5, sealY + 16, "F");
    doc.triangle(sealX + 6, sealY + 6, sealX + 1.5, sealY + 19, sealX + 8.5, sealY + 16, "F");
    doc.setFillColor(...gold);
    doc.circle(sealX, sealY, 13, "F");
    doc.setFillColor(...ivory);
    doc.circle(sealX, sealY, 10.5, "F");
    try {
      const sealLogo = await loadImageAsDataUrl("assets/logo-mahouto-plus.png");
      drawImageFit(doc, sealLogo, sealX, sealY - 8.5, 17, 17);
    } catch (err) { /* repli silencieux : anneau doré seul */ }

    // -------- Signature du fondateur (bas droite) --------
    const sigCenterX = pageW - 44;
    let sigLineY = qrY + 16;
    try {
      const sig = await loadImageAsDataUrl("assets/signature-fondateur.png");
      const h = drawImageFit(doc, sig, sigCenterX, qrY, 32, 15);
      sigLineY = qrY + h + 2;
    } catch (err) {
      sigLineY = qrY + 12;
    }
    doc.setDrawColor(...muted);
    doc.setLineWidth(0.3);
    doc.line(sigCenterX - 24, sigLineY, sigCenterX + 24, sigLineY);
    doc.setTextColor(...ink);
    doc.setFont("times", "bold");
    doc.setFontSize(10.5);
    doc.text("Mahouto Abdallah", sigCenterX, sigLineY + 5, { align: "center" });
    doc.setTextColor(...muted);
    doc.setFont("times", "normal");
    doc.setFontSize(8.5);
    doc.text("Fondateur — MAHOUTO+", sigCenterX, sigLineY + 9.5, { align: "center" });

    // -------- Pied de page (3 colonnes) --------
    const footY = 184;
    doc.setDrawColor(...gold);
    doc.setLineWidth(0.3);
    doc.line(cx - 88, footY - 6, cx - 88, footY + 10);
    doc.line(cx + 22, footY - 6, cx + 22, footY + 10);

    doc.setTextColor(...ink);
    doc.setFont("times", "bold");
    doc.setFontSize(8.5);
    doc.text("Délivré par MAHOUTO+", cx - 130, footY, { align: "left" });
    doc.text("/ MAJESTÉ PRESSE", cx - 130, footY + 5, { align: "left" });

    try {
      const mLogo = await loadImageAsDataUrl("assets/logo-mahouto-plus.png");
      drawImageFit(doc, mLogo, cx - 55, footY - 7, 10, 10);
    } catch (err) { /* repli silencieux */ }
    doc.setTextColor(...goldDark);
    doc.setFont("times", "bold");
    doc.setFontSize(9);
    doc.text("MAHOUTO+", cx - 44, footY - 2);
    doc.setTextColor(...muted);
    doc.setFont("times", "italic");
    doc.setFontSize(6.5);
    doc.text("L'Intelligence Artificielle, la Formation", cx - 44, footY + 3);
    doc.text("et le Business réunis dans une seule application.", cx - 44, footY + 6.5);

    try {
      const mpLogo = await loadImageAsDataUrl("assets/logo-majeste-presse.png");
      drawImageFit(doc, mpLogo, cx + 32, footY - 7, 10, 10);
    } catch (err) { /* repli silencieux */ }
    doc.setTextColor(...goldDark);
    doc.setFont("times", "bold");
    doc.setFontSize(9);
    doc.text("MAJESTÉ PRESSE", cx + 43, footY - 2);
    doc.setTextColor(...muted);
    doc.setFont("times", "italic");
    doc.setFontSize(6.5);
    doc.text("Votre Sérigraphe Imprimeur de confiance.", cx + 43, footY + 3);

    const safeName = (certificate.formationTitle || "certificat").replace(/[^a-zA-Z0-9 _-]/g, "_");
    doc.save("Certificat MAHOUTO+ - " + safeName + ".pdf");
  }

  return { download };
})();
