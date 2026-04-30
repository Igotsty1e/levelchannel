# PRODUCT REQUIREMENTS DOCUMENT (HISTORICAL)

> This document describes the first version of the landing page.
> The current technical implementation has already moved further:
> the site runs on server-side `Next.js`, and payments and the security perimeter are described in
> [README.md](README.md),
> [ARCHITECTURE.md](ARCHITECTURE.md),
> [SECURITY.md](SECURITY.md), and
> [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md).

## LevelChannel - Landing Page

---

# 1. Product Overview

**Product:** LevelChannel Landing Page
**Type:** Conversion landing page
**Model:** Individual online English lessons (1:1)
**Goal:** Lead generation via Telegram

---

# 2. Goals & Metrics

## North Star

**Leads per 100 visitors**

---

## Metrics

| Metric          | Target |
| --------------- | ------ |
| Conversion Rate | 5-10%+ |
| Telegram CTR    | >10%   |
| CTA Click Rate  | >15%   |
| Scroll Depth    | >60%   |

---

# 3. Target Audience

* 18-40 years old
* professionals (IT, business, product, etc.)
* goals:

  * exams (IELTS and others)
  * work / international career
  * conversational English

---

# 4. Value Proposition

> Individual English tailored to a specific goal
> with a measurable result

---

# 5. User Flow

```
Landing → Hero → Trust → UseCases → Results → CTA → Telegram → Conversation
```

---

# 6. Page Structure (Strict Order)

```
Header  
Hero  
TrustStats  
UseCases  
Process  
Results  
Teacher  
Pricing  
Payment  
FinalCTA  
Footer  
```

---

# 7. Core Functionality

---

## 7.1 Navigation

* sticky header
* smooth scroll
* anchor: `#cta`

---

## 7.2 CTA System

### Primary CTA (everywhere):

**Write to us on Telegram**

---

## Link:

```
https://t.me/anastasiia_englishcoach
```

---

## CTA placement:

* Hero
* Results
* Final CTA
* Header

---

## Behavior:

* opens in a new tab
* hover effect
* Telegram icon (optional)

---

## 7.3 Form

The form is completely absent.

Forbidden:

* any input fields
* data collection
* data storage

---

# 8. Payment

* method: **SBP (Faster Payments System)**
* integration: CloudPayments (in the future)

---

## Requirements:

* the site does not store payment data
* redirect / instructions only

---

# 9. UX/UI Requirements

---

## Style:

* minimalism
* premium
* dark theme

---

## Colors:

* background: #0B0B0C
* text: #FFFFFF
* secondary: #A1A1AA
* accent: gradient (purple → blue)

---

## Typography:

* H1: 36-48px
* H2: 24-32px
* body: 16-18px

---

## Spacing:

* 8px grid
* section padding:

  * desktop: 80px
  * mobile: 40px

---

# 10. Content Specification

---

## 10.1 Header

* logo: **LevelChannel**
* CTA: Write to us on Telegram

---

## 10.2 Hero

### H1:

English for your goal: from exams to working with international clients

---

### Subheading:

Individual 1:1 lessons
8 years of experience and over 10,000 hours of teaching

---

### Bullets:

* Preparation for IELTS and other exams
* English for work
* Conversational English

---

### CTA:

**Write to us on Telegram**

---

## 10.3 TrustStats

* 8 years of teaching
* 10,000+ hours
* 1:1 format
* international experience

---

## 10.4 UseCases

* Exams
* Work
* Conversational

---

## 10.5 Process

1. Goal definition
2. Individual plan
3. 1:1 lessons
4. Homework + feedback

---

## 10.6 Results (case studies)

1. IELTS 4.5 → 6.5
2. Exam in 6 weeks
3. Work (B2 → offer)
4. Conversational (3 months)
5. Networking (B1 → B2)

---

CTA:
**I want the same result → Telegram**

---

## 10.7 Teacher

Anastasia
8 years of experience
10,000+ hours
international experience

---

## 10.8 Pricing

* 60 minutes - «3 500 ₽»
* 90 minutes - «5 000 ₽»

---

## 10.9 Payment

Payment via SBP (Faster Payments System)
Fast and commission-free

---

CTA:
**Write to us on Telegram**

---

## 10.10 Final CTA

Heading:
Start learning toward your goal

---

Button:
**Write to us on Telegram**

---

# 11. Animations

* fade-in on scroll
* staggered appearance
* hover effects

---

# 12. Performance Requirements

* TTI < 2s
* LCP < 2.5s
* CLS < 0.1

---

# 13. Analytics

## Events:

| Event          | Trigger |
| -------------- | ------- |
| page_view      | load    |
| cta_click      | click   |
| telegram_click | click   |
| scroll_50      | scroll  |
| scroll_90      | scroll  |

---

# 14. LEGAL

---

## 14.1 Footer

Contains:

* Legal details (реквизиты)
* Public oferta (публичная оферта)
* Privacy policy

---

## 14.2 Legal details (реквизиты)

```
Individual Entrepreneur Firsova Anastasia Gennadievna  

INN (taxpayer ID): 673202755730  

Settlement account: 40802810720000971101  

Bank: LLC "Bank Tochka"  

BIC: 044525104  

Correspondent account: 30101810745374525104  

Bank city: Moscow  
```

---

## 14.3 Privacy Policy

URL: `/privacy`

---

### Text:

```
The site does not collect or store personal data of users.

Communication is carried out via Telegram, where data processing is governed by the policy of the respective service.

Payments are processed through third-party payment systems.
```

---

## 14.4 Public oferta (публичная оферта)

URL: `/offer`

---

Contains:

* description of the service
* format (1:1 online)
* price («3 500 ₽» / «5 000 ₽»)
* payment procedure (SBP / Faster Payments System)
* terms of service delivery

---

# 15. Constraints

* do not add forms
* do not store data
* do not add other payment methods
* do not change texts
* do not overload the UI

---

# 16. Mobile Requirements

* mobile-first
* buttons ≥44px
* readability

---

# 17. QA Checklist

* [ ] all CTAs lead to Telegram
* [ ] no forms
* [ ] Telegram works
* [ ] legal details (реквизиты) present
* [ ] oferta present
* [ ] privacy present
* [ ] mobile is correct
* [ ] no lag

---

# 18. Launch Plan

1. Deploy (Vercel)
2. Telegram check
3. Mobile check
4. Analytics check
5. Launch
