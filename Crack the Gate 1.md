# PicoCTF — Crack the Gate 1

**Category:** Web Exploitation
**Difficulty:** Easy
**Flag:** `picoCTF{brut4_f0rc4_49d1d186}`

---

## Challenge Description

> *"We're in the middle of an investigation. One of our persons of interest, ctf player, is believed to be hiding sensitive data inside a restricted web portal. We've uncovered the email address he uses to log in: `ctf-player@picoctf.org`. Unfortunately, we don't know the password, and the usual guessing techniques haven't worked. But something feels off... it's almost like the developer left a secret way in. Can you figure it out?"*

---

## My Thought Process

The moment I read this description, one phrase stood out to me:

> *"it's almost like the developer left a secret way in"*

That's a pretty direct hint. In the real world, developers sometimes leave debug notes, commented-out credentials, or backdoors in source code during development — and forget to clean them up before pushing to production. This is actually a well-known security mistake, and it's exactly the kind of thing a security researcher or attacker would look for first.

So before even opening Burp Suite or running any tools, my first instinct was simple: **check the page source.**

---

## Step-by-Step Walkthrough

### Step 1 — Open the Login Page

The challenge provided a URL with a login page. I opened it in the browser. It looked like a standard login form — email field, password field, submit button. Nothing unusual on the surface.

### Step 2 — View the Page Source

I right-clicked anywhere on the page and selected **"View Page Source"** (you can also press `Ctrl+U` on most browsers). This shows you the raw HTML of the page — including any comments the developer may have left behind.

And sure enough, buried in the HTML, there was a comment. It had some text that didn't look like plain English — it looked scrambled, like it had been encoded or obfuscated in some way.

> **Pro Tip for Beginners:** Always check the page source on web challenges. Developers leave comments, debug notes, and sometimes even credentials in plain HTML. It takes 5 seconds and it pays off more often than you'd think.

### Step 3 — Decode the Note with CyberChef

The comment looked like it had been rotated — the letters were shifted in a way that reminded me of **ROT13**, which is one of the simplest and most common "encodings" you'll see in beginner CTF challenges.

ROT13 works by shifting every letter 13 places forward in the alphabet (since the alphabet has 26 letters, applying ROT13 twice gets you back to the original). It's not real encryption — it's more of an obfuscation trick. But it's enough to hide something from a casual glance.

I opened [CyberChef](https://gchq.github.io/CyberChef/) and:

1. Pasted the encoded note into the **Input** field
2. Searched for **"ROT13"** in the operations panel and dragged it into the Recipe
3. Checked the **Output** — it decoded cleanly into a login bypass

My gut was right.

> **CyberChef** is an incredibly useful browser-based tool for encoding/decoding, encryption, and data transformation. Bookmark it — you'll use it constantly in CTFs.

### Step 4 — Use the Login Bypass via Burp Suite

Now that I had the bypass, I needed to use it. I opened **Burp Suite**, made sure my browser was routing traffic through Burp's proxy, and submitted the login form. Burp intercepted the request.

I then forwarded the request to **Repeater** (`Ctrl+R`), where I could manually edit and resend HTTP requests.

I copied the login bypass from CyberChef and pasted it into the appropriate field in the request, then clicked **Send**.

The server responded with the flag.

> **Why Burp Suite Repeater?** Repeater lets you manually craft and replay HTTP requests without going through the browser every time. It's perfect for testing login bypasses, injections, and parameter tampering. If you haven't explored it yet, it's worth learning early.

---

## Flag

```
picoCTF{brut4_f0rc4_49d1d186}
```

---

## Key Takeaways

1. **Always read the challenge description carefully.** The phrase "developer left a secret way in" was practically telling you where to look. Challenge authors almost always hide hints in plain sight.

2. **View Page Source is your first move on web challenges.** Before running any tools, check the HTML. It costs nothing and can solve the challenge in under a minute.

3. **ROT13 is everywhere in beginner CTFs.** If you see scrambled text that still looks vaguely English-shaped, try ROT13 first. CyberChef makes this a two-second job.

4. **Burp Suite Repeater is essential for web exploitation.** Once you have a payload, Repeater gives you a clean environment to test it without fighting your browser.

5. **Developer mistakes are real vulnerabilities.** This challenge is a simplified version of something that actually happens — credentials and debug info left in source code. Tools like [GitLeaks](https://github.com/gitleaks/gitleaks) exist specifically to catch these leaks in real codebases.

---

## Tools Used

| Tool | Purpose |
|------|---------|
| Browser (View Page Source) | Initial recon — finding the hidden comment in HTML |
| [CyberChef](https://gchq.github.io/CyberChef/) | Decoding the ROT13-encoded note |
| Burp Suite (Repeater) | Delivering the login bypass via a crafted HTTP request |

---