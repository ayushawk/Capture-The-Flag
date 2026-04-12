# PicoCTF — SOAP (Medium) Writeup

## Challenge Info

| Field       | Details                          |
|-------------|----------------------------------|
| **Name**    | SOAP                             |
| **CTF**     | PicoCTF                          |
| **Category**| Web Exploitation                 |
| **Difficulty** | Medium                        |
| **Description** | *"The web project was rushed and no security assessment was done. Can you read the /etc/passwd file?"* |

---

## Vulnerability

**XXE — XML External Entity Injection**

XXE is an OWASP Top 10 vulnerability that occurs when an application parses XML input and allows the use of external entities. When external entity processing is enabled, an attacker can reference local files on the server, causing the parser to read and return their contents.

---

## Tools Used

- **Burp Suite** — to intercept, inspect, and modify the HTTP request

---

## Reconnaissance

Opening the challenge URL and using the web application normally, I intercepted the outgoing POST request in **Burp Suite**. The request was sent to `/data` with a `Content-Type: application/xml` header.

**Original request body:**
```xml
<?xml version="1.0" encoding="UTF-8"?><data><ID>3</ID></data>
```

This confirmed that the application accepts and parses XML input. The `<ID>` field was reflected back in the response, making it the ideal injection point.

---

## Exploitation

The challenge asked to read `/etc/passwd`, which is a classic XXE local file read target.

I crafted a malicious XML payload that:
1. Declares an external entity (`xxe`) pointing to `file:///etc/passwd`
2. Injects it into the `<ID>` field — preserving the original XML structure

**Malicious payload:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<data>
  <ID>&xxe;</ID>
</data>
```

I sent this via **Burp Suite Repeater** to `POST /data`.

---

## Key Lesson

The first attempts returned **500 Internal Server Error** because the XML structure didn't match what the server expected. The fix was to **match the original XML structure exactly** (`<data><ID>`) — the server was rejecting structurally invalid requests before even reaching the parser.

Once the structure matched, the external entity was processed and the contents of `/etc/passwd` were returned in the response.

---

## Why This Works

- The backend parsed XML using a library with **external entity processing enabled** (insecure default)
- The `<ID>` value was **reflected** in the response, so the file contents were visible
- No input sanitization or XML security hardening was in place

---

## Remediation

| Fix | Details |
|-----|---------|
| Disable external entities | Set `resolve_entities=False` in lxml or use `defusedxml` in Python |
| Use `defusedxml` | A Python library that blocks XXE by default |
| Input validation | Reject unexpected XML structures or fields |
| Least privilege | Run the web server as a user with minimal file read permissions |

---

## Flag

```
picoCTF{...}
```

---

## References

- [OWASP XXE Injection](https://owasp.org/www-community/vulnerabilities/XML_External_Entity_(XXE)_Processing)
- [PortSwigger XXE Guide](https://portswigger.net/web-security/xxe)
- [defusedxml — Python secure XML parsing](https://github.com/tiran/defusedxml)