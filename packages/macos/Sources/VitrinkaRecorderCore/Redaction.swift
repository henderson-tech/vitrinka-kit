#if DEBUG
import Foundation

// The Swift port of @vitrinka/redact (packages/redact/src/index.ts).
//
// The semantics are defined by packages/redact/spec/REDACTION-SPEC.md, and
// conformance by packages/redact/spec/vectors.json, which the test suite runs
// against this file. Every function mirrors its TypeScript counterpart; the
// comments there explain WHY each rule exists, so this file keeps only the
// notes that are specific to the port.
//
// String positions are UTF-16 code units, as in JavaScript, and the regexes
// are ICU translations of the JavaScript ones (see RX).

/// Replaces every scrubbed value: a marker, not "", so a replayed session
/// still shows that the field was present.
package let REDACTED = "[redacted]"

/// The workspace redaction policy, as `GET /api/v1/recorder/policy` serves it
/// under its `policy` key.
package struct RedactionPolicy: Sendable, Equatable {
    package var extraHeaders: [String] = []
    package var extraBodyKeys: [String] = []
    package var patterns: [String] = []
    package var maskAllText = false
    package var fullFidelity = false

    package init(
        extraHeaders: [String] = [], extraBodyKeys: [String] = [], patterns: [String] = [],
        maskAllText: Bool = false, fullFidelity: Bool = false
    ) {
        self.extraHeaders = extraHeaders
        self.extraBodyKeys = extraBodyKeys
        self.patterns = patterns
        self.maskAllText = maskAllText
        self.fullFidelity = fullFidelity
    }

    /// Read the policy object. Unknown fields are ignored and malformed ones
    /// fall back to the safe value (never to fullFidelity).
    package init(json: JSONValue) {
        func strings(_ key: String) -> [String] {
            json[key]?.arrayValue?.compactMap(\.stringValue) ?? []
        }
        extraHeaders = strings("extraHeaders")
        extraBodyKeys = strings("extraBodyKeys")
        patterns = strings("patterns")
        maskAllText = json["maskAllText"]?.boolValue == true
        fullFidelity = json["fullFidelity"]?.boolValue == true
    }

    package var json: JSONValue {
        .object([
            "extraHeaders": .array(extraHeaders.map { .string($0) }),
            "extraBodyKeys": .array(extraBodyKeys.map { .string($0) }),
            "patterns": .array(patterns.map { .string($0) }),
            "maskAllText": .bool(maskAllText),
            "fullFidelity": .bool(fullFidelity),
        ])
    }
}

/// What a pixel (screenshot) surface must do under the rules.
package enum PixelPolicy: String, Sendable {
    case none
    case blur
}

/// rrweb-style DOM masking options (kept for parity with the engine API).
package struct MaskDirectives: Sendable, Equatable {
    package var maskAllInputs: Bool
    package var maskAllText: Bool
    package var maskTextSelector: String?
}

/// A compiled policy. `RedactionRules(policy: nil)` is the full default rule
/// set: a client whose policy fetch failed must use it (fail closed).
package struct RedactionRules: Sendable {
    package let full: Bool
    package let maskAllText: Bool
    package let headers: Set<String>
    package let bodyKeys: Set<String>
    package let patterns: [RX]

    package static let defaults = RedactionRules(policy: nil)

    package init(policy: RedactionPolicy?) {
        var headers = Set(Redact.defaultHeaders)
        var bodyKeys = Set(Redact.defaultBodyKeys)
        var patterns: [RX] = []
        for h in policy?.extraHeaders ?? [] {
            let n = Redact.norm(h)
            if !n.isEmpty { headers.insert(n) }
        }
        for k in policy?.extraBodyKeys ?? [] {
            let n = Redact.norm(k)
            if !n.isEmpty { bodyKeys.insert(n) }
        }
        for p in policy?.patterns ?? [] {
            // Server-validated as RE2; a pattern ICU cannot compile is skipped
            // and the rest keep working (the server backstop still applies it).
            if let rx = RX(compiling: p) { patterns.append(rx) }
        }
        full = policy?.fullFidelity == true
        maskAllText = policy?.maskAllText == true
        self.headers = headers
        self.bodyKeys = bodyKeys
        self.patterns = patterns
    }
}

package enum Redact {
    static let defaultHeaders = [
        "authorization", "proxyauthorization", "cookie", "setcookie",
        "xapikey", "xauthtoken", "xcsrftoken", "xamzsecuritytoken",
    ]

    static let defaultBodyKeys = [
        "password", "passwd", "secret", "token", "accesstoken", "refreshtoken", "idtoken",
        "authorization", "apikey", "clientsecret", "card", "cardnumber", "cvv", "cvc", "pin", "ssn",
    ]

    static let secretTokens: Set<String> = [
        "password", "passwd", "pwd", "secret", "token", "auth", "authorization", "otp", "pin",
        "apikey", "credential", "credentials", "cookie", "cvv", "cvc", "iban", "ssn",
    ]

    static let secretPhrases: Set<String> = [
        "apikey", "privatekey", "secretkey", "sessionid", "cardnumber", "birthnumber",
        "rodnecislo", "accesstoken", "refreshtoken", "idtoken",
    ]

    /// Lowercase, `-` and `_` removed.
    package static func norm(_ s: String) -> String {
        String(s.lowercased().unicodeScalars.filter { $0 != "-" && $0 != "_" })
    }

    private static let camelBoundary = RX("([a-z0-9])([A-Z])")

    /// Lowercase word tokens of a key: camelCase, snake_case, kebab-case, dots.
    static func tokenize(_ key: String) -> [String] {
        let spaced = camelBoundary.ns.stringByReplacingMatches(
            in: key, options: [], range: NSRange(location: 0, length: key.jsLength), withTemplate: "$1 $2")
        var tokens: [String] = []
        var current = ""
        for u in spaced.unicodeScalars {
            let v = u.value
            if (0x30 ... 0x39).contains(v) || (0x41 ... 0x5A).contains(v) || (0x61 ... 0x7A).contains(v) {
                current.unicodeScalars.append(u)
            } else if !current.isEmpty {
                tokens.append(current.lowercased())
                current = ""
            }
        }
        if !current.isEmpty { tokens.append(current.lowercased()) }
        return tokens
    }

    /// Token-wise secret detection (token matching, never substrings).
    package static func isSecretKey(_ key: String) -> Bool {
        let tokens = tokenize(key)
        if tokens.contains(where: { secretTokens.contains($0) }) { return true }
        for i in tokens.indices {
            var run = ""
            for j in i ..< tokens.count {
                run += tokens[j]
                if secretPhrases.contains(run) { return true }
                if run.count > 24 { break }
            }
        }
        return false
    }

    package static func sensitiveHeader(_ rules: RedactionRules, _ name: String) -> Bool {
        let n = norm(name)
        return rules.headers.contains(n) || n.hasSuffix("apikey") || n.hasSuffix("token") || isSecretKey(name)
    }

    package static func sensitiveBodyKey(_ rules: RedactionRules, _ name: String) -> Bool {
        rules.bodyKeys.contains(norm(name)) || isSecretKey(name)
    }

    package static func sensitiveParam(_ rules: RedactionRules, _ name: String) -> Bool {
        if sensitiveBodyKey(rules, name) { return true }
        let n = norm(name)
        return n.hasSuffix("apikey") || n.hasSuffix("token")
    }

    // MARK: Value patterns

    /// `$` of the JavaScript pattern (no `m` flag) is `\z` here: ICU's `$`
    /// also stops before a final line break.
    private static let pemPrivateKey = RX(#"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|\z)"#)
    private static let pemPrivateKeyHeader = RX(#"-----BEGIN[A-Z +]*PRIVATE[ +]KEY-----"#)

    static func scrubPem(_ s: String) -> String {
        s.contains("PRIVATE KEY-----") ? pemPrivateKey.replaceAll(s, with: REDACTED) : s
    }

    static func maskPatterns(_ rules: RedactionRules, _ s: String) -> String {
        var out = scrubPem(s)
        for rx in rules.patterns { out = rx.replaceAll(out, with: REDACTED) }
        return out
    }

    // MARK: Percent-decoding for inspection

    private static let pairKey = RX(#"([A-Za-z][A-Za-z0-9_.\-\[\]]{0,60})\s*[:=]"#)

    static func containsSecretPair(_ rules: RedactionRules, _ text: String) -> Bool {
        if pemPrivateKeyHeader.test(text) { return true }
        for m in pairKey.matches(text) {
            if let k = m.group(1), sensitiveBodyKey(rules, k) { return true }
        }
        return false
    }

    static func safeDecode(_ s: String) -> String {
        var out = s
        for _ in 0 ..< 3 {
            let next = decodeEscapes(out)
            if next == out { break }
            out = next
        }
        return out
    }

    private static let escapeRun = RX("(%[0-9A-Fa-f]{2})+")
    private static let singleEscape = RX("%([0-9A-Fa-f]{2})")

    static func decodeEscapes(_ s: String) -> String {
        if !s.contains("%") { return s }
        if let all = decodeURIComponent(s) { return all }
        return escapeRun.replace(s) { m in
            let seq = m.whole
            if let d = decodeURIComponent(seq) { return d }
            return singleEscape.replace(seq) { e in
                guard let hex = e.group(1), let code = UInt8(hex, radix: 16), code < 0x80 else { return e.whole }
                return String(UnicodeScalar(code))
            }
        }
    }

    // MARK: URLs

    /// Redact sensitive-keyed pairs in one raw query/fragment/form string,
    /// split on BOTH `&` and `;`. A fully benign string comes back identical.
    package static func scrubPairs(
        _ rules: RedactionRules, _ sensitive: (RedactionRules, String) -> Bool, _ raw: String
    ) -> String {
        var changed = false
        let out = raw.jsSplit(["&", ";"]).map { p -> String in
            if p.isEmpty { return p }
            let i = p.jsIndexOf("=")
            let key = i.map { p.jsSlice(0, $0) } ?? p
            let name = safeDecode(key.replacingOccurrences(of: "+", with: " "))
            let q = name.jsLastIndexOf("?")
            let nested = q.map { name.jsSlice($0 + 1) }
            if sensitive(rules, name) || (nested.map { sensitive(rules, $0) } ?? false) {
                changed = true
                return "\(key)=\(REDACTED)"
            }
            if let i, containsSecretPair(rules, safeDecode(p.jsSlice(i + 1))) {
                changed = true
                return "\(key)=\(REDACTED)"
            }
            return p
        }
        return changed ? out.joined(separator: "&") : raw
    }

    /// Scrub the query AND the fragment of one URL, string-split end to end.
    package static func redactUrl(_ rules: RedactionRules, _ raw: String) -> String {
        if rules.full || raw.isEmpty { return raw }
        guard let i = raw.utf16.firstIndex(where: { $0 == 0x3F || $0 == 0x23 }) else {
            return maskPatterns(rules, raw)
        }
        let at = raw.utf16.distance(from: raw.utf16.startIndex, to: i)
        let scrubbed = raw.jsSlice(at + 1)
            .jsSplit(literal: "#")
            .map { scrubPairs(rules, sensitiveParam, $0) }
            .joined(separator: "#")
        return maskPatterns(rules, raw.jsSlice(0, at + 1) + scrubbed)
    }

    // MARK: Free text

    private static let kvPair = RX(#"([A-Za-z][A-Za-z0-9_.\-\[\]]{0,60})("?\s*[:=]\s*(?!//))("?)([^&?"'\s,}]*)\3"#)
    private static let queryParam = RX(#"([?&])([^=&#\s]{1,120})=([^&#\s]*)"#)
    private static let headerLine = RX(#"^([A-Za-z][A-Za-z0-9_.-]{0,60})[ \t]*:[ \t]*(.+)$"#, [.anchorsMatchLines])
    private static let midLineAuth = RX(#"\b((?:proxy-)?authorization|www-authenticate)(\s*[:=]\s*)[^\r\n]+"#, [.caseInsensitive])
    private static let schemeChallenge = RX(#"\b(Digest|Negotiate|NTLM)\s+(?=[A-Za-z][A-Za-z-]{0,30}\s*=)[^\r\n]+"#, [.caseInsensitive])
    private static let bearerBasic = RX(#"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+"#, [.caseInsensitive])
    private static let bareJwt = RX(#"\beyJ[A-Za-z0-9._-]{10,}"#)

    static let maskTextLimit = 128 * 1024

    static func maskText(_ rules: RedactionRules, _ text: String) -> String {
        if text.jsLength > maskTextLimit { return "[body omitted: \(text.jsLength) bytes, unmaskable]" }
        var s = scrubPem(text)
        s = headerLine.replace(s) { m in
            let key = m.group(1) ?? ""
            return sensitiveHeader(rules, key) ? "\(key): \(REDACTED)" : m.whole
        }
        s = midLineAuth.replace(s) { m in "\(m.group(1) ?? "")\(m.group(2) ?? "")\(REDACTED)" }
        s = schemeChallenge.replace(s) { m in "\(m.group(1) ?? "") \(REDACTED)" }
        s = bearerBasic.replace(s) { m in "\(m.group(1) ?? "") \(REDACTED)" }
        s = bareJwt.replaceAll(s, with: REDACTED)
        s = queryParam.replace(s) { m in
            let lead = m.group(1) ?? ""
            let key = m.group(2) ?? ""
            let value = m.group(3) ?? ""
            if sensitiveParam(rules, safeDecode(key)) { return "\(lead)\(key)=\(REDACTED)" }
            if containsSecretPair(rules, safeDecode(value)) { return "\(lead)\(key)=\(REDACTED)" }
            return m.whole
        }
        s = kvPair.replace(s) { m in
            let key = m.group(1) ?? ""
            let sep = m.group(2) ?? ""
            let quote = m.group(3) ?? ""
            let value = m.group(4) ?? ""
            if value == REDACTED { return m.whole }
            return sensitiveBodyKey(rules, key) ? "\(key)\(sep)\(quote)\(REDACTED)\(quote)" : m.whole
        }
        return maskPatterns(rules, s)
    }

    // MARK: Bodies

    static func urlKey(_ k: String) -> Bool {
        switch norm(k) {
        case "url", "href", "uri", "location": return true
        default: return false
        }
    }

    static let maxScrubDepth = 64

    static func scrubTree(_ rules: RedactionRules, _ v: JSONValue, _ depth: Int) -> JSONValue {
        if depth > maxScrubDepth { return .string(REDACTED) }
        switch v {
        case let .array(a):
            return .array(a.map { scrubTree(rules, $0, depth + 1) })
        case let .object(o):
            var out = JSONObject()
            for e in o.entries {
                if sensitiveBodyKey(rules, e.key) {
                    out[e.key] = .string(REDACTED)
                } else if case let .string(s) = e.value, urlKey(e.key) {
                    out[e.key] = .string(redactUrl(rules, s))
                } else {
                    out[e.key] = scrubTree(rules, e.value, depth + 1)
                }
            }
            return .object(out)
        case let .string(s):
            return .string(maskPatterns(rules, s))
        default:
            return v
        }
    }

    private static let jsonEscape = RX(#"\\u([0-9A-Fa-f]{4})|\\(.)"#)

    static func decodeJsonKey(_ key: String) -> String {
        if !key.contains("\\") { return key }
        return jsonEscape.replace(key) { m in
            if let hex = m.group(1), let code = UInt16(hex, radix: 16) {
                return String(decoding: [code], as: UTF16.self)
            }
            return m.group(2) ?? ""
        }
    }

    private static let compoundKey = RX(#""((?:[^"\\\r\n]|\\.)*)"\s*:\s*[{\[]"#)
    private static let truncatedPair = RX(#"("((?:[A-Za-z0-9_-]|\\u[0-9A-Fa-f]{4}|\\.)+)"\s*:\s*)("(?:[^"\\]|\\.)*"?|[^,{}\[\]"\r\n]*)"#)

    static func scrubTruncatedJson(_ rules: RedactionRules, _ body: String) -> String {
        for m in compoundKey.matches(body) {
            if sensitiveBodyKey(rules, decodeJsonKey(m.group(1) ?? "")) { return "" }
        }
        return truncatedPair.replace(body) { m in
            let pre = m.group(1) ?? ""
            let key = m.group(2) ?? ""
            return sensitiveBodyKey(rules, decodeJsonKey(key)) ? "\(pre)\"\(REDACTED)\"" : m.whole
        }
    }

    static func looksLikeJson(_ text: String) -> Bool {
        let t = text.trimmingLeadingJSWhitespace()
        return t.hasPrefix("{") || t.hasPrefix("[")
    }

    private static let boundary = RX(#"boundary="?([^";]+)"?"#, [.caseInsensitive])
    private static let dispositionName = RX(#"content-disposition:[^\r\n]*;\s*name="([^"]*)""#, [.caseInsensitive])

    static func scrubMultipart(_ rules: RedactionRules, _ body: String, _ contentType: String) -> String? {
        guard let bm = boundary.matches(contentType).first, let b = bm.group(1) else { return nil }
        let delim = "--\(b)"
        let segs = body.jsSplit(literal: delim)
        guard segs.count >= 3, segs[0].isEmpty else { return nil }
        guard segs[segs.count - 1].jsStartsWith("--") else { return nil }
        var out = [segs[0]]
        for i in 1 ..< segs.count - 1 {
            let seg = segs[i]
            guard seg.jsStartsWith("\r\n"), seg.jsEndsWith("\r\n"), let hb = seg.jsIndexOf("\r\n\r\n") else { return nil }
            let partHeaders = seg.jsSlice(2, hb)
            let value = seg.jsSlice(hb + 4, -2)
            let name = dispositionName.matches(partHeaders).first?.group(1) ?? ""
            let scrubbed = !name.isEmpty && sensitiveBodyKey(rules, name) ? REDACTED : maskText(rules, value)
            out.append("\r\n\(partHeaders)\r\n\r\n\(scrubbed)\r\n")
        }
        out.append(segs[segs.count - 1])
        return out.joined(separator: delim)
    }

    static let jsonStructuralLimit = 256 * 1024

    /// Scrub one request/response body by shape and content type. Never throws.
    package static func redactBody(_ rules: RedactionRules, _ body: String, contentType: String? = nil) -> String {
        if rules.full || body.isEmpty { return body }
        if looksLikeJson(body) {
            if body.jsLength <= jsonStructuralLimit, let parsed = try? JSONValue.parse(body) {
                return scrubTree(rules, parsed, 0).serialized()
            }
            return maskPatterns(rules, scrubTruncatedJson(rules, body))
        }
        let ct = (contentType ?? "").lowercased()
        if ct.contains("x-www-form-urlencoded") {
            return maskText(rules, scrubPairs(rules, sensitiveBodyKey, body))
        }
        if ct.contains("multipart/form-data") {
            if let scrubbed = scrubMultipart(rules, body, contentType ?? "") { return scrubbed }
            return "[multipart body omitted: unparseable (\(body.jsLength) chars)]"
        }
        return maskText(rules, body)
    }

    /// Redact a free-text capture (console line, label, title). Never throws.
    package static func redactText(_ rules: RedactionRules, _ text: String) -> String {
        if rules.full { return text }
        if looksLikeJson(text), let parsed = try? JSONValue.parse(text) {
            return scrubTree(rules, parsed, 0).serialized()
        }
        return maskText(rules, text)
    }

    /// Redact, then cap to `cap` UTF-16 units, in the shape-aware order.
    package static func redactAndCap(_ rules: RedactionRules, _ body: String, cap: Int, contentType: String? = nil) -> String {
        func capped(_ s: String) -> String { s.jsLength > cap ? s.jsSlice(0, cap) + "…[truncated]" : s }
        if rules.full { return capped(body) }
        if body.jsLength > cap, contentType?.lowercased().contains("multipart/form-data") == true {
            return "[multipart body omitted: oversized (\(body.jsLength) chars)]"
        }
        if looksLikeJson(body), body.jsLength <= jsonStructuralLimit {
            return capped(redactBody(rules, body, contentType: contentType))
        }
        return redactBody(rules, capped(body), contentType: contentType)
    }

    /// Scrub and cap a captured header map; order is kept.
    package static func redactHeaders(
        _ rules: RedactionRules, _ headers: [(String, String)], maxValueLen: Int = 1024, budget: Int = 8192
    ) -> [(String, String)] {
        var left = budget
        var out: [(String, String)] = []
        for (k, v) in headers {
            let raw = rules.full ? v : sensitiveHeader(rules, k) ? REDACTED : maskPatterns(rules, v)
            let val = raw.jsSlice(0, maxValueLen)
            left -= k.jsLength + val.jsLength
            if left < 0 {
                out.append(("…", "(truncated)"))
                break
            }
            out.append((k, val))
        }
        return out
    }

    package static func maskDirectives(_ rules: RedactionRules) -> MaskDirectives {
        if rules.full { return MaskDirectives(maskAllInputs: false, maskAllText: false, maskTextSelector: nil) }
        return MaskDirectives(maskAllInputs: true, maskAllText: rules.maskAllText, maskTextSelector: rules.maskAllText ? "*" : nil)
    }

    package static func pixelPolicy(_ rules: RedactionRules) -> PixelPolicy {
        !rules.full && rules.maskAllText ? .blur : .none
    }
}

extension RedactionRules {
    package func redactUrl(_ s: String) -> String { Redact.redactUrl(self, s) }
    package func redactText(_ s: String) -> String { Redact.redactText(self, s) }
    package var pixelPolicy: PixelPolicy { Redact.pixelPolicy(self) }
}
#endif
