"""Offline AES-256-GCM authentication using the system OpenSSL libcrypto.

No secrets are passed to a child process or command-line arguments. A missing or
unsupported libcrypto is a hard failure; this is not a replacement TLS client.
"""
import base64
import ctypes
import re

class VerificationError(Exception):
    pass

def decode_b64url(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise VerificationError()
    try:
        raw = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
        if base64.urlsafe_b64encode(raw).decode().rstrip('=') != value:
            raise VerificationError()
        return raw
    except (ValueError, TypeError):
        raise VerificationError() from None

def decrypt_bundle(key_hex, bundle, aad=b'trioz-trusttunnel-pilot-v1', max_ciphertext=48000):
    if not isinstance(key_hex, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', key_hex):
        raise VerificationError()
    if not isinstance(aad, bytes) or not aad or not isinstance(max_ciphertext, int) or not 1 <= max_ciphertext <= 1048576:
        raise VerificationError()
    if not isinstance(bundle, str) or len(bundle) > max(65536, max_ciphertext * 2):
        raise VerificationError()
    parts = bundle.split('.')
    if len(parts) != 4 or parts[0] != 'v1':
        raise VerificationError()
    iv, ciphertext, tag = map(decode_b64url, parts[1:])
    if len(iv) != 12 or len(tag) != 16 or not 1 <= len(ciphertext) <= max_ciphertext:
        raise VerificationError()
    try:
        lib = ctypes.CDLL('libcrypto.so.3')
        P = ctypes.c_void_p
        lib.EVP_CIPHER_CTX_new.argtypes = []; lib.EVP_CIPHER_CTX_new.restype = P
        lib.EVP_CIPHER_CTX_free.argtypes = [P]; lib.EVP_CIPHER_CTX_free.restype = None
        lib.EVP_aes_256_gcm.argtypes = []; lib.EVP_aes_256_gcm.restype = P
        lib.EVP_DecryptInit_ex.argtypes = [P,P,P,P,P]; lib.EVP_DecryptInit_ex.restype = ctypes.c_int
        lib.EVP_CIPHER_CTX_ctrl.argtypes = [P,ctypes.c_int,ctypes.c_int,P]; lib.EVP_CIPHER_CTX_ctrl.restype = ctypes.c_int
        lib.EVP_DecryptUpdate.argtypes = [P,P,ctypes.POINTER(ctypes.c_int),P,ctypes.c_int]; lib.EVP_DecryptUpdate.restype = ctypes.c_int
        lib.EVP_DecryptFinal_ex.argtypes = [P,P,ctypes.POINTER(ctypes.c_int)]; lib.EVP_DecryptFinal_ex.restype = ctypes.c_int
        ctx = lib.EVP_CIPHER_CTX_new()
        if not ctx: raise VerificationError()
        buffers = []
        def buffer(raw):
            b = ctypes.create_string_buffer(raw, max(1,len(raw))); buffers.append(b); return b
        try:
            keybuf, ivbuf, inbuf, tagbuf = map(buffer, (bytes.fromhex(key_hex), iv, ciphertext, tag))
            aad = buffer(aad)
            out = ctypes.create_string_buffer(len(ciphertext)+16); buffers.append(out)
            n = ctypes.c_int(); final = ctypes.c_int()
            if lib.EVP_DecryptInit_ex(ctx,lib.EVP_aes_256_gcm(),None,None,None) != 1: raise VerificationError()
            if lib.EVP_CIPHER_CTX_ctrl(ctx,0x9,len(iv),None) != 1: raise VerificationError()
            if lib.EVP_DecryptInit_ex(ctx,None,None,keybuf,ivbuf) != 1: raise VerificationError()
            if lib.EVP_DecryptUpdate(ctx,None,ctypes.byref(n),aad,len(aad)) != 1: raise VerificationError()
            if lib.EVP_DecryptUpdate(ctx,out,ctypes.byref(n),inbuf,len(ciphertext)) != 1: raise VerificationError()
            size=n.value
            if not 0 <= size <= len(ciphertext): raise VerificationError()
            if lib.EVP_CIPHER_CTX_ctrl(ctx,0x11,len(tag),tagbuf) != 1: raise VerificationError()
            if lib.EVP_DecryptFinal_ex(ctx,ctypes.byref(out,size),ctypes.byref(final)) != 1: raise VerificationError()
            if final.value < 0 or size+final.value > len(ciphertext)+16: raise VerificationError()
            return out.raw[:size+final.value]
        finally:
            lib.EVP_CIPHER_CTX_free(ctx)
            for b in buffers: ctypes.memset(ctypes.addressof(b),0,ctypes.sizeof(b))
    except (OSError, AttributeError, TypeError, ValueError):
        raise VerificationError() from None
