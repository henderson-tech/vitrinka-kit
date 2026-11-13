#if DEBUG
import Foundation

/// An ordered JSON value.
///
/// The recorder builds every wire body and every persisted file with it, and
/// the redaction engine walks parsed bodies with it. Objects keep their key
/// order, and `serialized()` writes what JavaScript's `JSON.stringify` writes
/// for the same value (escapes, number formatting, integer-like keys first).
/// That keeps byte counts (the batch budget) and redaction output identical
/// to the TypeScript reference implementation.
package enum JSONValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object(JSONObject)

    package var stringValue: String? {
        if case let .string(s) = self { return s }
        return nil
    }

    package var doubleValue: Double? {
        if case let .number(n) = self { return n }
        return nil
    }

    package var intValue: Int? {
        guard case let .number(n) = self, n.isFinite, n.rounded() == n, abs(n) < 9.0e15 else { return nil }
        return Int(n)
    }

    package var boolValue: Bool? {
        if case let .bool(b) = self { return b }
        return nil
    }

    package var objectValue: JSONObject? {
        if case let .object(o) = self { return o }
        return nil
    }

    package var arrayValue: [JSONValue]? {
        if case let .array(a) = self { return a }
        return nil
    }

    package subscript(key: String) -> JSONValue? {
        objectValue?[key]
    }
}

/// A JSON object that keeps insertion order. Setting an existing key replaces
/// its value in place (JavaScript semantics, also for duplicate keys in a
/// parsed document: the last value wins at the first position).
package struct JSONObject: Sendable, Equatable {
    package struct Entry: Sendable, Equatable {
        package var key: String
        package var value: JSONValue
    }

    package private(set) var entries: [Entry] = []
    private var index: [String: Int] = [:]

    package init() {}

    package init(_ pairs: [(String, JSONValue)]) {
        for (k, v) in pairs { self[k] = v }
    }

    package var keys: [String] { entries.map(\.key) }
    package var count: Int { entries.count }
    package var isEmpty: Bool { entries.isEmpty }

    package subscript(key: String) -> JSONValue? {
        get { index[key].map { entries[$0].value } }
        set {
            if let i = index[key] {
                if let newValue {
                    entries[i].value = newValue
                } else {
                    entries.remove(at: i)
                    rebuildIndex()
                }
            } else if let newValue {
                index[key] = entries.count
                entries.append(Entry(key: key, value: newValue))
            }
        }
    }

    private mutating func rebuildIndex() {
        index = [:]
        for (i, e) in entries.enumerated() { index[e.key] = i }
    }

    package static func == (a: JSONObject, b: JSONObject) -> Bool { a.entries == b.entries }
}

// MARK: - Literals

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral,
    ExpressibleByDictionaryLiteral
{
    package init(nilLiteral: ()) { self = .null }
    package init(booleanLiteral value: Bool) { self = .bool(value) }
    package init(integerLiteral value: Int) { self = .number(Double(value)) }
    package init(floatLiteral value: Double) { self = .number(value) }
    package init(stringLiteral value: String) { self = .string(value) }
    package init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    package init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(JSONObject(elements)) }
}

extension JSONObject: ExpressibleByDictionaryLiteral {
    package init(dictionaryLiteral elements: (String, JSONValue)...) { self.init(elements) }
}

// MARK: - Parsing (JSON.parse semantics)

package struct JSONParseError: Error, Sendable, CustomStringConvertible {
    package let offset: Int
    package let reason: String
    package var description: String { "JSON parse error at byte \(offset): \(reason)" }
}

extension JSONValue {
    /// Parse a complete JSON document, as strictly as `JSON.parse`.
    package static func parse(_ text: String) throws -> JSONValue {
        try parse(Array(text.utf8))
    }

    package static func parse(_ data: Data) throws -> JSONValue {
        try parse([UInt8](data))
    }

    package static func parse(_ bytes: [UInt8]) throws -> JSONValue {
        var p = JSONParser(bytes: bytes)
        p.skipWhitespace()
        let v = try p.value(depth: 0)
        p.skipWhitespace()
        guard p.pos == bytes.count else { throw p.fail("unexpected trailing content") }
        return v
    }
}

private struct JSONParser {
    let bytes: [UInt8]
    var pos = 0
    /// Deep enough for any real body; a hostile one fails to parse (and the
    /// redaction engine then takes its truncated-JSON fallback).
    static let maxDepth = 512

    func fail(_ reason: String) -> JSONParseError { JSONParseError(offset: pos, reason: reason) }

    mutating func skipWhitespace() {
        while pos < bytes.count {
            switch bytes[pos] {
            case 0x20, 0x09, 0x0A, 0x0D: pos += 1
            default: return
            }
        }
    }

    mutating func value(depth: Int) throws -> JSONValue {
        guard depth < Self.maxDepth else { throw fail("nesting too deep") }
        guard pos < bytes.count else { throw fail("unexpected end") }
        switch bytes[pos] {
        case UInt8(ascii: "{"): return try object(depth: depth)
        case UInt8(ascii: "["): return try array(depth: depth)
        case UInt8(ascii: "\""): return .string(try string())
        case UInt8(ascii: "t"): try literal("true"); return .bool(true)
        case UInt8(ascii: "f"): try literal("false"); return .bool(false)
        case UInt8(ascii: "n"): try literal("null"); return .null
        default: return .number(try number())
        }
    }

    mutating func literal(_ word: String) throws {
        let w = Array(word.utf8)
        guard pos + w.count <= bytes.count, Array(bytes[pos ..< pos + w.count]) == w else {
            throw fail("invalid literal")
        }
        pos += w.count
    }

    mutating func object(depth: Int) throws -> JSONValue {
        pos += 1
        var obj = JSONObject()
        skipWhitespace()
        if pos < bytes.count, bytes[pos] == UInt8(ascii: "}") {
            pos += 1
            return .object(obj)
        }
        while true {
            skipWhitespace()
            guard pos < bytes.count, bytes[pos] == UInt8(ascii: "\"") else { throw fail("expected a key") }
            let key = try string()
            skipWhitespace()
            guard pos < bytes.count, bytes[pos] == UInt8(ascii: ":") else { throw fail("expected ':'") }
            pos += 1
            skipWhitespace()
            obj[key] = try value(depth: depth + 1)
            skipWhitespace()
            guard pos < bytes.count else { throw fail("unterminated object") }
            if bytes[pos] == UInt8(ascii: ",") { pos += 1; continue }
            if bytes[pos] == UInt8(ascii: "}") { pos += 1; return .object(obj) }
            throw fail("expected ',' or '}'")
        }
    }

    mutating func array(depth: Int) throws -> JSONValue {
        pos += 1
        var out: [JSONValue] = []
        skipWhitespace()
        if pos < bytes.count, bytes[pos] == UInt8(ascii: "]") {
            pos += 1
            return .array(out)
        }
        while true {
            skipWhitespace()
            out.append(try value(depth: depth + 1))
            skipWhitespace()
            guard pos < bytes.count else { throw fail("unterminated array") }
            if bytes[pos] == UInt8(ascii: ",") { pos += 1; continue }
            if bytes[pos] == UInt8(ascii: "]") { pos += 1; return .array(out) }
            throw fail("expected ',' or ']'")
        }
    }

    mutating func hex4() throws -> UInt16 {
        guard pos + 4 <= bytes.count else { throw fail("short \\u escape") }
        var v: UInt16 = 0
        for _ in 0 ..< 4 {
            let c = bytes[pos]
            let d: UInt16
            switch c {
            case 0x30 ... 0x39: d = UInt16(c - 0x30)
            case 0x41 ... 0x46: d = UInt16(c - 0x41 + 10)
            case 0x61 ... 0x66: d = UInt16(c - 0x61 + 10)
            default: throw fail("bad \\u escape")
            }
            v = v << 4 | d
            pos += 1
        }
        return v
    }

    mutating func string() throws -> String {
        pos += 1 // opening quote
        var units: [UInt16] = []
        var run = pos
        func flushRun(_ end: Int, into units: inout [UInt16]) {
            if end > run { units.append(contentsOf: String(decoding: bytes[run ..< end], as: UTF8.self).utf16) }
        }
        while pos < bytes.count {
            let c = bytes[pos]
            if c == UInt8(ascii: "\"") {
                flushRun(pos, into: &units)
                pos += 1
                return String(decoding: units, as: UTF16.self)
            }
            if c < 0x20 { throw fail("control character in string") }
            if c == UInt8(ascii: "\\") {
                flushRun(pos, into: &units)
                pos += 1
                guard pos < bytes.count else { throw fail("unterminated escape") }
                let e = bytes[pos]
                pos += 1
                switch e {
                case UInt8(ascii: "\""): units.append(0x22)
                case UInt8(ascii: "\\"): units.append(0x5C)
                case UInt8(ascii: "/"): units.append(0x2F)
                case UInt8(ascii: "b"): units.append(0x08)
                case UInt8(ascii: "f"): units.append(0x0C)
                case UInt8(ascii: "n"): units.append(0x0A)
                case UInt8(ascii: "r"): units.append(0x0D)
                case UInt8(ascii: "t"): units.append(0x09)
                case UInt8(ascii: "u"): units.append(try hex4())
                default: throw fail("bad escape")
                }
                run = pos
                continue
            }
            pos += 1
        }
        throw fail("unterminated string")
    }

    mutating func number() throws -> Double {
        let start = pos
        if pos < bytes.count, bytes[pos] == UInt8(ascii: "-") { pos += 1 }
        guard pos < bytes.count else { throw fail("bad number") }
        if bytes[pos] == UInt8(ascii: "0") {
            pos += 1
        } else if (0x31 ... 0x39).contains(bytes[pos]) {
            while pos < bytes.count, (0x30 ... 0x39).contains(bytes[pos]) { pos += 1 }
        } else {
            throw fail("unexpected character")
        }
        if pos < bytes.count, bytes[pos] == UInt8(ascii: ".") {
            pos += 1
            let fracStart = pos
            while pos < bytes.count, (0x30 ... 0x39).contains(bytes[pos]) { pos += 1 }
            guard pos > fracStart else { throw fail("bad fraction") }
        }
        if pos < bytes.count, bytes[pos] == UInt8(ascii: "e") || bytes[pos] == UInt8(ascii: "E") {
            pos += 1
            if pos < bytes.count, bytes[pos] == UInt8(ascii: "+") || bytes[pos] == UInt8(ascii: "-") { pos += 1 }
            let expStart = pos
            while pos < bytes.count, (0x30 ... 0x39).contains(bytes[pos]) { pos += 1 }
            guard pos > expStart else { throw fail("bad exponent") }
        }
        let text = String(decoding: bytes[start ..< pos], as: UTF8.self)
        guard let d = Double(text) else { throw fail("bad number") }
        return d
    }
}

// MARK: - Serializing (JSON.stringify semantics)

extension JSONValue {
    /// The compact JSON text JavaScript's `JSON.stringify` produces.
    package func serialized() -> String {
        var out = ""
        write(into: &out)
        return out
    }

    package func serializedData() -> Data { Data(serialized().utf8) }

    private func write(into out: inout String) {
        switch self {
        case .null: out += "null"
        case let .bool(b): out += b ? "true" : "false"
        case let .number(n): out += JSONValue.jsNumber(n)
        case let .string(s): JSONValue.writeString(s, into: &out)
        case let .array(a):
            out += "["
            for (i, v) in a.enumerated() {
                if i > 0 { out += "," }
                v.write(into: &out)
            }
            out += "]"
        case let .object(o):
            out += "{"
            var first = true
            for e in JSONValue.jsKeyOrder(o) {
                if !first { out += "," }
                first = false
                JSONValue.writeString(e.key, into: &out)
                out += ":"
                e.value.write(into: &out)
            }
            out += "}"
        }
    }

    /// JavaScript enumerates array-index keys ("0", "17") first, ascending,
    /// then every other key in insertion order.
    private static func jsKeyOrder(_ o: JSONObject) -> [JSONObject.Entry] {
        var indexed: [(UInt32, JSONObject.Entry)] = []
        var rest: [JSONObject.Entry] = []
        for e in o.entries {
            if let i = arrayIndex(e.key) { indexed.append((i, e)) } else { rest.append(e) }
        }
        if indexed.isEmpty { return rest }
        return indexed.sorted { $0.0 < $1.0 }.map(\.1) + rest
    }

    private static func arrayIndex(_ key: String) -> UInt32? {
        guard !key.isEmpty, key.utf8.count <= 10, key.utf8.allSatisfy({ (0x30 ... 0x39).contains($0) }) else { return nil }
        if key.utf8.count > 1, key.utf8.first == 0x30 { return nil }
        guard let v = UInt64(key), v < 4_294_967_295 else { return nil }
        return UInt32(v)
    }

    private static func writeString(_ s: String, into out: inout String) {
        out += "\""
        for u in s.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 {
                    let hex = String(u.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        out += "\""
    }

    /// ECMAScript Number::toString for a finite double (shortest round-trip
    /// digits, exponent form only beyond 1e21 or below 1e-6).
    package static func jsNumber(_ d: Double) -> String {
        guard d.isFinite else { return "null" }
        if d == 0 { return "0" }
        let s = "\(abs(d))"
        var mantissa = Substring(s)
        var exp = 0
        if let e = s.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = s[..<e]
            exp = Int(s[s.index(after: e)...]) ?? 0
        }
        let parts = mantissa.split(separator: ".", omittingEmptySubsequences: false)
        let intPart = String(parts[0])
        let fracPart = parts.count > 1 ? String(parts[1]) : ""
        var digits = Array(intPart + fracPart)
        var n = intPart.count + exp
        while digits.count > 1, digits.first == "0" {
            digits.removeFirst()
            n -= 1
        }
        while digits.count > 1, digits.last == "0" { digits.removeLast() }
        let k = digits.count
        let ds = String(digits)
        let out: String
        if k <= n, n <= 21 {
            out = ds + String(repeating: "0", count: n - k)
        } else if n > 0, n <= 21 {
            out = String(digits[0 ..< n]) + "." + String(digits[n...])
        } else if n > -6, n <= 0 {
            out = "0." + String(repeating: "0", count: -n) + ds
        } else {
            let e = n - 1
            let es = e >= 0 ? "+\(e)" : "\(e)"
            out = k == 1 ? ds + "e" + es : String(digits[0]) + "." + String(digits[1...]) + "e" + es
        }
        return d < 0 ? "-" + out : out
    }
}
#endif
