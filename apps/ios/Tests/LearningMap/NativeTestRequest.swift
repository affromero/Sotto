import Foundation

extension URLRequest {
    func capturingNativeTestBody() throws -> URLRequest {
        var saved = self
        if saved.httpBody == nil, let stream = httpBodyStream {
            stream.open(); defer { stream.close() }
            var bytes = Data(); let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 65536)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: 65536)
                if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeRawData) }
                if count == 0 { break }
                bytes.append(buffer, count: count)
            }
            saved.httpBody = bytes
        }
        return saved
    }
}
