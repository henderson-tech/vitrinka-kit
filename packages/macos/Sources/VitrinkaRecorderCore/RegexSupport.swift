#if DEBUG
import Foundation

/// A compiled regular expression that may live in a `static let`.
///
/// NSRegularExpression is immutable and documented thread-safe; the wrapper
/// only states that to the compiler. Patterns are ICU, ported from the
/// TypeScript engine's JavaScript regexes: a `[` inside a class is escaped
/// (ICU reads it as a nested set) and an end-of-input `$` is `\z`.
package struct RX: @unchecked Sendable {
    package let ns: NSRegularExpression

    package init(_ pattern: String, _ options: NSRegularExpression.Options = []) {
        // Every built-in pattern is a literal checked by the test suite; a
        // failure here is a programming error.
        ns = try! NSRegularExpression(pattern: pattern, options: options)
    }

    package init?(compiling pattern: String) {
        guard let ns = try? NSRegularExpression(pattern: pattern, options: []) else { return nil }
        self.ns = ns
    }

    /// One match, with groups read as JavaScript reads them: an unmatched
    /// group is nil.
    package struct Match {
        let text: NSString
        let result: NSTextCheckingResult

        package var whole: String { text.substring(with: result.range) }

        package func group(_ i: Int) -> String? {
            guard i < result.numberOfRanges else { return nil }
            let r = result.range(at: i)
            return r.location == NSNotFound ? nil : text.substring(with: r)
        }
    }

    package func test(_ s: String) -> Bool {
        let ns = s as NSString
        return self.ns.firstMatch(in: s, options: [], range: NSRange(location: 0, length: ns.length)) != nil
    }

    package func matches(_ s: String) -> [Match] {
        let text = s as NSString
        return ns.matches(in: s, options: [], range: NSRange(location: 0, length: text.length))
            .map { Match(text: text, result: $0) }
    }

    /// `s.replace(/re/g, fn)`.
    package func replace(_ s: String, _ fn: (Match) -> String) -> String {
        let text = s as NSString
        let found = ns.matches(in: s, options: [], range: NSRange(location: 0, length: text.length))
        if found.isEmpty { return s }
        var out = ""
        var last = 0
        for r in found {
            out += text.substring(with: NSRange(location: last, length: r.range.location - last))
            out += fn(Match(text: text, result: r))
            last = r.range.location + r.range.length
        }
        out += text.substring(from: last)
        return out
    }

    /// `s.replace(/re/g, constant)` with no `$` references.
    package func replaceAll(_ s: String, with literal: String) -> String {
        replace(s) { _ in literal }
    }
}

/// JavaScript string operations over UTF-16 code units, so indices and
/// lengths match the reference engine.
extension String {
    package var jsLength: Int { (self as NSString).length }

    package func jsSlice(_ start: Int, _ end: Int? = nil) -> String {
        let ns = self as NSString
        let len = ns.length
        func clamp(_ i: Int) -> Int { i < 0 ? max(0, len + i) : min(i, len) }
        let a = clamp(start)
        let b = clamp(end ?? len)
        return b > a ? ns.substring(with: NSRange(location: a, length: b - a)) : ""
    }

    package func jsIndexOf(_ needle: String) -> Int? {
        let r = (self as NSString).range(of: needle, options: .literal)
        return r.location == NSNotFound ? nil : r.location
    }

    package func jsLastIndexOf(_ needle: String) -> Int? {
        let r = (self as NSString).range(of: needle, options: [.literal, .backwards])
        return r.location == NSNotFound ? nil : r.location
    }

    package func jsStartsWith(_ prefix: String) -> Bool { (self as NSString).hasPrefix(prefix) }
    package func jsEndsWith(_ suffix: String) -> Bool { (self as NSString).hasSuffix(suffix) }

    /// `split(sep)` keeping empty pieces, for single-unit ASCII separators.
    package func jsSplit(_ separators: Set<Character>) -> [String] {
        split(omittingEmptySubsequences: false, whereSeparator: { separators.contains($0) }).map(String.init)
    }

    /// `split(sep)` keeping empty pieces, for a literal separator string.
    package func jsSplit(literal sep: String) -> [String] {
        components(separatedBy: sep)
    }

    package func trimmingLeadingJSWhitespace() -> Substring {
        drop(while: { $0.isWhitespace || $0 == "\u{FEFF}" })
    }
}

/// `decodeURIComponent`: nil where JavaScript throws (a `%` without two hex
/// digits, or escapes that are not valid UTF-8).
package func decodeURIComponent(_ s: String) -> String? {
    if !s.contains("%") { return s }
    var bytes: [UInt8] = []
    bytes.reserveCapacity(s.utf8.count)
    let u = Array(s.utf8)
    var i = 0
    func hex(_ c: UInt8) -> UInt8? {
        switch c {
        case 0x30 ... 0x39: return c - 0x30
        case 0x41 ... 0x46: return c - 0x41 + 10
        case 0x61 ... 0x66: return c - 0x61 + 10
        default: return nil
        }
    }
    while i < u.count {
        if u[i] == UInt8(ascii: "%") {
            guard i + 2 < u.count, let h = hex(u[i + 1]), let l = hex(u[i + 2]) else { return nil }
            bytes.append(h << 4 | l)
            i += 3
        } else {
            bytes.append(u[i])
            i += 1
        }
    }
    return String(bytes: bytes, encoding: .utf8)
}
#endif
