"""
scrape_pacsun.py — Fetch ALL products from Pacsun by category and insert into Stitch cache
===========================================================================

HOW TO USE:
    1. pip install requests psycopg2-binary beautifulsoup4
    2. Get fresh cookies from your browser:
         - Go to pacsun.com/mens/ in Chrome and browse around
         - Press F12 -> Network tab -> Fetch/XHR
         - Click any pacsun.com request -> Headers -> copy the full "cookie:" value
         - Paste it below as COOKIE_RAW (Windows CMD escaping is cleaned automatically)
    3. Run:  python scripts/python/scrape_pacsun.py

HOW IT WORKS:
    Uses Pacsun's Search-ShowAjax endpoint which loads category pages in bulk.
    Each request returns a page of HTML containing product cards.
    We parse the product data (title, price, image, URL) from that HTML.
    Pagination is controlled by the ?page=0, ?page=1, etc. parameter.

    URL format:
        GET /on/demandware.store/Sites-pacsun-Site/default/Search-ShowAjax
            ?cgid=mens-clothing&page=0&selectedUrl=...

    Requires your browser cookies (PerimeterX bot protection).
    Must be run from your home computer, not a server.

HOW TO FIND CATEGORY IDs (cgid):
    1. Go to pacsun.com and click a category (e.g. Mens -> Clothing)
    2. Look at the URL — the part after /mens/ or /womens/ is the cgid
       Example: https://www.pacsun.com/mens/clothing/  -> cgid = mens-clothing
    3. Or check the Network tab for Search-ShowAjax requests and look at
       the cgid= param in the request URL

IMPORTANT:
    Don't commit your cookie string to GitHub!
===========================================================================
"""

import requests
import psycopg2
import json
import re
import time
from bs4 import BeautifulSoup


# ── PASTE YOUR COOKIE STRING HERE ─────────────────────────────────────────────
# Get from: pacsun.com -> DevTools (F12) -> Network -> any request -> Headers -> cookie:
# Windows CMD cURL escaping (^%^, ^\^") is cleaned automatically.
COOKIE_RAW = r"""cqcid=cewB0yOcYwO5ZVDOHHJ7ZbGyaz; cquid=^|^|; cc-nx-g_pacsun=V8smrhBRplDDnwJZuIkxopaXMG1o4vcY9aPl0PUmdyQ; usid_pacsun=1b2cda5e-0de8-43e7-b4a6-a62968c4639a; dwanonymous_78c84c42fd4f92c32bc3e441b58528a1=cewB0yOcYwO5ZVDOHHJ7ZbGyaz; GlobalE_Data=^%^7B^%^22countryISO^%^22^%^3A^%^22US^%^22^%^2C^%^22cultureCode^%^22^%^3A^%^22en-US^%^22^%^2C^%^22currencyCode^%^22^%^3A^%^22USD^%^22^%^2C^%^22apiVersion^%^22^%^3A^%^222.1.4^%^22^%^7D; __cq_dnt=0; dw_dnt=0; _pxhd=5cqfZYndMB2BblqtsJMkzxjyrHMLulMDr7x4mG0qSUhZg8w2J3wUN1yZuckjpZmQ/wW5tGqsxSPUcPnDqLXaHw==:Em8R/r4D5bjh9iyg41qp9j7KYINPONAYD6vvDWPeO/E6SG1G98pmZBAHELtGn-Vwu-87iMViuCyimzIpbyQPxhaUmqPaJ/azjQUXK4ZORJk=; _cfuvid=mozeHGwtSR6g_XfISifXd10EiLa7LtmUvd_8JCOo4ME-1780164518.404318-1.0.1.1-2TfmOm6LOKfqyRQAwhhPejqszYYeBn56wLZhDc3qU.Y; _pxvid=95232268-5c52-11f1-8eee-45a4f6f37179; __attn_eat_id=e9ab2a2b6b594788a71689e1fcc361ae; __pxvid=95c31383-5c52-11f1-ba23-fa7ad71b6348; __attentive_id=917371a773974401b201be90e3ff946b; __attentive_cco=1780164519964; tracker_device=04c3b94a-9fc8-4ed0-9968-92ee6da54373; _attn_bopd_=none; __attentive_dv=1; _dyid=3265109985026844582; RoktRecogniser=bcb1138a-784a-4b69-8111-9a3b6bbdf0d2; __cq_uuid=cewB0yOcYwO5ZVDOHHJ7ZbGyaz; _gcl_au=1.1.1694179548.1780164522; GlobalE_Full_Redirect=false; rskxRunCookie=0; rCookie=jlsdkh97eppotvo76mtnfmpsnzt0q; linc.web_chat.ids.client.development=eyIzOTkiOnsidXNlcklkIjoiNmExYjI3YWJkZTgzY2IwMDFiMzE4NzNhIn19; OptanonAlertBoxClosed=2026-05-30T18:08:46.706Z; utag_main_vapi_domain=pacsun.com; s_fid=23B93EF7D88DCA06-038FB5B2BCE53736; s_cc=true; __spdt=4864da0eb897488ea02168eff3b616f8; IR_gbd=pacsun.com; s_vi=^[CS^]v1^|350D93D7BC5F0A80-6000111B813F1A66^[CE^]; _gid=GA1.2.1268115274.1780164528; nt_page_init_referrer=NeotagEncrypt^%^3AU2FsdGVkX19iSGmmPuZ8YMO4fsSmIROKV7lOj5mRgHA^%^3D; nt_page_init_referring_domain=NeotagEncrypt^%^3AU2FsdGVkX19vyPk9K^%^2FjnDALZCpO^%^2FgGBP2in9JL8KXSQ^%^3D; _scid=dXL_xZVHwnM7PS3UTvSh6GSHu0scmB_c; _pin_unauth=dWlkPVptVXlZbVZtTURVdE5qZGtOeTAwTlRnd0xUa3dOVEl0Wm1FNU1XVmtOVFE0WVRoaA; _tt_enable_cookie=1; _ttp=01KSX16338H6QP9BXNC8QHSNYR_.tt.1; _sctr=1^%^7C1780113600000; PS=g^%^3Dmens^%^3Bp1^%^3Dall^%^3Bp2^%^3Dall^%^3Bm^%^3D2^%^3Bw^%^3D0^%^3Bk^%^3D0^%^3B; __cq_bc=^%^7B^%^22aaje-pacsun^%^22^%^3A^%^5B^%^7B^%^22id^%^22^%^3A^%^220630143150001^%^22^%^2C^%^22sku^%^22^%^3A^%^222845899^%^22^%^7D^%^5D^%^7D; tfExperimentId=t-4bce4e3394e3479685e8b8ac27a9147f; tf-version=v1; yotpo_pixel=48890a3c-58d0-4740-a1df-afdc16adb4c9; tfc-l=^%^7B^%^22k^%^22^%^3A^%^7B^%^22v^%^22^%^3A^%^22mnm607ep7cqm4qjnke96n4caju^%^22^%^2C^%^22e^%^22^%^3A1843064108^%^7D^%^7D; _sp_id.c2dd=2cd279f35d5ea2fe.1780164909.1.1780164909.1780164909; __cq_seg=0~0.29^!1~-0.04^!2~0.10^!3~0.61^!4~-0.43^!5~0.04^!6~0.32^!7~-0.19^!8~-0.27^!9~-0.38; cc-at_pacsun=eyJ2ZXIiOiIxLjAiLCJqa3UiOiJzbGFzL3Byb2QvYWFqZV9wcmQiLCJraWQiOiI1MmQ3MDI3NC1kNjk1LTRjY2QtYjk4NS0wYTc0ZDNlYTJhY2UiLCJ0eXAiOiJqd3QiLCJjbHYiOiJKMi4zLjQiLCJhbGciOiJFUzI1NiJ9.eyJhdXQiOiJHVUlEIiwic2NwIjoic2ZjYy5zaG9wcGVyLW15YWNjb3VudC5iYXNrZXRzIHNmY2Muc2hvcHBlci1kaXNjb3Zlcnktc2VhcmNoIHNmY2Muc2hvcHBlci1wcm9kdWN0cyBzZmNjLnNob3BwZXItbXlhY2NvdW50LnJ3IHNmY2Muc2hvcHBlci1jdXN0b21lcnMubG9naW4gc2ZjYy5zaG9wcGVyLXN0b3JlcyBzZmNjLnNob3BwZXItbXlhY2NvdW50Lm9yZGVycyBzZmNjLnNob3BwZXItY3VzdG9tZXJzLnJlZ2lzdGVyIHNmY2Muc2hvcHBlci1teWFjY291bnQuYWRkcmVzc2VzLnJ3IHNmY2Muc2hvcHBlci1teWFjY291bnQucHJvZHVjdGxpc3RzLnJ3IHNmY2Muc2hvcHBlci1wcm9kdWN0bGlzdHMgc2ZjYy5zaG9wcGVyLXByb21vdGlvbnMgc2ZjYy5zZXNzaW9uX2JyaWRnZSBzZmNjLnNob3BwZXItYmFza2V0cy1vcmRlcnMucncgc2ZjYy5zaG9wcGVyLWdpZnQtY2VydGlmaWNhdGVzIHNmY2Muc2hvcHBlci1teWFjY291bnQucGF5bWVudGluc3RydW1lbnRzLnJ3IHNmY2Muc2hvcHBlci1wcm9kdWN0LXNlYXJjaCBzZmNjLnNob3BwZXItY2F0ZWdvcmllcyIsInN1YiI6ImNjLXNsYXM6OmFhamVfcHJkOjpzY2lkOmZmYWNlODM4LTU2MWItNDkxMy04YjY1LTQ2YWJiNjQ5MGMyODo6dXNpZDoxYjJjZGE1ZS0wZGU4LTQzZTctYjRhNi1hNjI5NjhjNDYzOWEiLCJzc2MiOiJoanhyM2Y5cSIsImN0eCI6InNsYXMiLCJpc3MiOiJzbGFzL3Byb2QvYWFqZV9wcmQiLCJpc3QiOjEsImRudCI6IjAiLCJhdWQiOiJjb21tZXJjZWNsb3VkL3Byb2QvYWFqZV9wcmQiLCJuYmYiOjE3ODAxNzM1MjksInN0eSI6IlVzZXIiLCJpc2IiOiJ1aWRvOnNsYXM6OnVwbjpHdWVzdDo6dWlkbjpHdWVzdCBVc2VyOjpnY2lkOmNld0IweU9jWXdPNVpWRE9ISEo3WmJHeWF6OjpzZXNiOnNlc3Npb25fYnJpZGdlOjpjaGlkOnBhY3N1biIsImV4cCI6MTc4MDE3NTM1OSwiaWF0IjoxNzgwMTczNTU5LCJqdGkiOiJDMkMtMTA3NzYxMzkwMjA4NDEwNTQzMDUyMjQ4Mjk1NTk5NTM4NzU2MyJ9.-4mzADQNK80AQwdq_HcVoiftshBInq-gAf_v4qaSlEevG28bCD7yG3ikHYaZbyiQDVNkoiShJvWOBZMsZZ3BBw; dwsid=wS2xUJBfG3zw2DQiAuGmrUJmorZ75C5cdPxRKqn9qhIq3co-OJAjJG7fXozjD3uSR6IcDzS2H-LqfAg1KH3oQQ==; __cf_bm=XUqAj.0tKgurQda9F5bVNDURj1q_dzMnZpl6BgqfpUM-1780173559.1695347-1.0.1.1-NCLNuL7Sqf_4jKHaBwX1KyrZFSpBqMRLN81SuMnHXRxG3U377PilPSXNV.kb01qc4YQJkFRXTSVCgTguj3Awu7W0iSeShiC_7PuHfE4tC0zEIIW7hM1sGhSvdPixo3cQ; dwac_bcRhAiaagQXjEaaac1rgZNLbGQ=26ivxg4_6OSTC6BooonFvFjjvCDlhN3EFy8^%^3D^|dw-only^|^|^|USD^|false^|US^%^2FPacific^|true; sid=26ivxg4_6OSTC6BooonFvFjjvCDlhN3EFy8; marketingID=GOG; _dyid_server=3265109985026844582; _dyjsession=ndlcrn474k4c9k0ulc8lwnriga8tc2yq; OptanonConsent=isGpcEnabled=0^&datestamp=Sat+May+30+2026+16^%^3A39^%^3A20+GMT-0400+(Eastern+Daylight+Time)^&version=202402.1.0^&browserGpcFlag=0^&isIABGlobal=false^&hosts=^&consentId=90555c2f-f7cd-446d-a47b-cddea81c5d5d^&interactionCount=1^&isAnonUser=1^&landingPath=NotLandingPage^&groups=C0003^%^3A1^%^2CC0001^%^3A1^%^2CC0002^%^3A1^%^2CC0004^%^3A1^%^2CSSPD_BG^%^3A1^%^2CC0005^%^3A1^&geolocation=US^%^3BMI^&AwaitingReconsent=false; fw_se=^{^%^22value^%^22:^%^22fws2.de1161e2-6576-4485-bf49-23f5c3fbe8c2.2.1780173560517^%^22^%^2C^%^22createTime^%^22:^%^222026-05-30T20:39:20.517Z^%^22^}; fw_uid=^{^%^22value^%^22:^%^22746ace7a-de38-4000-b2f9-cea39ace9a02^%^22^%^2C^%^22createTime^%^22:^%^222026-05-30T20:39:20.524Z^%^22^}; _attn_=eyJ1Ijoie1wiY29cIjoxNzgwMTY0NTE5OTYzLFwidW9cIjoxNzgwMTY0NTE5OTYzLFwibWFcIjoyMTkwMCxcImluXCI6ZmFsc2UsXCJ2YWxcIjpcIjkxNzM3MWE3NzM5NzQ0MDFiMjAxYmU5MGUzZmY5NDZiXCJ9IiwiZWF0Ijoie1wiY29cIjoxNzgwMTczNTYwODk1LFwidW9cIjoxNzgwMTczNTYwODk1LFwibWFcIjozNjUwLFwiaW5cIjp0cnVlLFwidmFsXCI6XCJodHRwczovL2RkeGhqLnBhY3N1bi5jb21cIn0ifQ==; __attentive_session_id=8d764c113c9f4a719aac928af6dd5b90; _px3=4f6ebee6e99de2b93d2a882fc3fe4c833ec3f17798e9ff3ccaa6d01d6d77ede1:cr9ZOtZyXJKpiWKf42uW6kp+w9ChIBagEGd8yujn6slbRDyhNhUAA9biTrG3Kp8kN2LCVlKAhaCwKbtFJ0rX3w==:1000:te7YFb6X3JgwXI980dfMuMrLuOkUEqXWJmWgDV+xapt7JMXTWEZGycAw3cKPgxJoamrGasvnHFj7spo2oEHnkqWNMdaQ84esZGYJEaqMtaMXDYCQoG1NouIRD32ih4k2/EiGTgbl8maJm5Wz08bSizz04jDPfVchYFILp5rgd7GlgVJd7UpFCTKJzl12V9gKNQZRVOm0DK/I+ZgQrqv2FcbZ5UD1WQuPE5HqdAs6GUF10Pz3ZHObOvEDDjabc+um/o9FmVVCUm9BP4mXsADLw2W0Qw+LEq/bogielsSqEnxGnSUJhj3BPPCztQgH7CtyS4wn8cHFraNV07qJN88sxIZ0xjwrniu1l0vgOFBf2PnhcTmW1jOWHCwPwZizRviVGYzeMHg+4unCWbWEfxqFHxu0UcCcA9ku06HGBapha6tkpS1efgFsdKLSamOneg7kql/dhsj3WP8q7I6MmqcwQQ==; fw_bid=^{^%^22value^%^22:^%^22gYME0g^%^22^%^2C^%^22createTime^%^22:^%^222026-05-30T20:39:21.427Z^%^22^}; fw_chid=^{^%^22value^%^22:^%^22767yKz0^%^22^%^2C^%^22createTime^%^22:^%^222026-05-30T20:39:21.428Z^%^22^}; _dy_soct=1780173561^!476626.-1'826658.-8658'826659.-8625'826660.-1'1764053.-9041'2792530.-1'2792532.-8658'3470338.0^!ndlcrn474k4c9k0ulc8lwnriga8tc2yq~968481.0; __attentive_pv=1; __attentive_ss_referrer=https://www.google.com/; s_dfa=pacsunglobalprod; s_vs=1; s_dl=1; nt_gclid=Cj0KCQjwlerQBhDMARIsAB16H-VtvFjKjmDfzfhqidjvot3fsrL8eC6JypYdpFf247_EG1SI8uJRFWoaAprfEALw_wcB; nt_gbraid=0AAAAAD8PNsciLU4Buo7ZeZAIbihOzxDmJ; neo_sc=NeotagEncrypt^%^3AU2FsdGVkX18r8^%^2Bb90LfZ1^%^2BflwZ83P66yjMWAlwvX1qw^%^3D; nt_user_id=NeotagEncrypt^%^3AU2FsdGVkX19WOwSjnzj8uUbyZwxHf7zzXz05UrlyWrU^%^3D; nt_trait=NeotagEncrypt^%^3AU2FsdGVkX1^%^2FIT374oZ1eaGBQKn1oYDVnnMBL^%^2FaZJSWQ^%^3D; nt_group_id=NeotagEncrypt^%^3AU2FsdGVkX19QGg6ETbPTLdSVgF7GUaqMRrWvNM8HjyQ^%^3D; nt_group_trait=NeotagEncrypt^%^3AU2FsdGVkX18yccjKMDqkIpUH9E3^%^2BRNBPP9Rcwcjxpvc^%^3D; nt_anonymous_id=NeotagEncrypt^%^3AU2FsdGVkX1^%^2BnkwxxpVh9B8Skw35YraRcmhxyVTfsh^%^2Fo9yjlauOI2wDXoQGz98BbOZ1hbOeHyLnIoAIKnC5dzZQ^%^3D^%^3D; neo_session=NeotagEncrypt^%^3AU2FsdGVkX18wz0M^%^2Fq^%^2FXvdUfr02XvsasSd^%^2FWrG0F2nzuI18816yAgs8gFlHyny^%^2BJ7hHIZ9jot0bcYuRaos3ANY8pRcuAMHQhpN5RFnKLvem^%^2BCpIjZSRajcMsr2ktorYlicyntK0^%^2F70t^%^2FxlIQUjT8B6Q^%^3D^%^3D; utag_main__sn=2; utag_main__se=1^%^3Bexp-session; utag_main__ss=1^%^3Bexp-session; utag_main__st=1780175361873^%^3Bexp-session; utag_main_ses_id=1780173561873^%^3Bexp-session; utag_main__pn=1^%^3Bexp-session; productnum=4; s_sq=^%^5B^%^5BB^%^5D^%^5D; cto_bundle=2c1cql8zYkdTa2QzVjh1bCUyRjVvJTJCTXVwRGswdmM1ajZUdm1JRVBaZDJta1J5OEdwUHFKYTFUaHFGaWI1R25VUFpBcGVCR2hEV3Z1ZyUyQkJXbDJIRG4zWm9ZTHh1MFhpdUw0cGdJZUZVZjZST0dWMlRSd0RBTzZUWkhBcVZ6UXFVUDJZemtZUGF5OVdQbUdHNjVWblU4Z2tvWlBsQVElM0QlM0Q; __apex_test__=; _rdt_uuid=1780164527304.dc05904f-2786-4d2c-ad2b-cab19de509c2; IR_28645=1780173562613^%^7Cc-55640^%^7C1780173562613^%^7C^%^7C; IR_PI=9a94264a-5c52-11f1-9274-834ee536f6d3^%^7C1780259962613; _gac_UA-433579-18=1.1780173563.Cj0KCQjwlerQBhDMARIsAB16H-VtvFjKjmDfzfhqidjvot3fsrL8eC6JypYdpFf247_EG1SI8uJRFWoaAprfEALw_wcB; _gcl_aw=GCL.1780173563.Cj0KCQjwlerQBhDMARIsAB16H-VtvFjKjmDfzfhqidjvot3fsrL8eC6JypYdpFf247_EG1SI8uJRFWoaAprfEALw_wcB; _gcl_dc=GCL.1780173563.Cj0KCQjwlerQBhDMARIsAB16H-VtvFjKjmDfzfhqidjvot3fsrL8eC6JypYdpFf247_EG1SI8uJRFWoaAprfEALw_wcB; _gcl_gs=2.1.k1^$i1780173559^$u215295638; _ga_J4F3Q27YH0=GS2.1.s1780173562^$o2^$g0^$t1780173562^$j60^$l1^$h786929002; _ga=GA1.1.1213820116.1780164522; _uetsid=9a8561805c5211f1a51bcdb33ac7cdad; _uetvid=9a8599105c5211f18548ff7c55640edd; _scid_r=gvL_xZVHwnM7PS3UTvSh6GSHu0scmB_cCey-Kw; forterToken=0ac4481f07a0476493eab0994efcbd32_1780173560453__UDF43-m4_27ck_; GlobalE_Analytics=^%^7B^%^22merchantId^%^22^%^3A1175^%^2C^%^22shopperCountryCode^%^22^%^3A^%^22US^%^22^%^2C^%^22cdn^%^22^%^3A^%^22https^%^3A^%^2F^%^2Fweb-pacsun.global-e.com^%^2F^%^22^%^2C^%^22clientId^%^22^%^3A^%^22f0523625-6003-41f5-808e-d373f00cd61e^%^22^%^2C^%^22sessionId^%^22^%^3A^%^22ede9b5fe-485a-4869-b47f-1d90ab1947dd^%^22^%^2C^%^22sessionIdExpiry^%^22^%^3A1780175363896^%^2C^%^22configurations^%^22^%^3A^%^7B^%^7D^%^2C^%^22featureToggles^%^22^%^3A^%^7B^%^22FT_3DA^%^22^%^3Atrue^%^2C^%^22FT_3DA_UTM_SOURCE_LIST^%^22^%^3A^%^5B^%^22borderfree^%^22^%^5D^%^2C^%^22FT_3DA_STORAGE_LIFETIME^%^22^%^3A4320^%^2C^%^22FT_BF_GOOGLE_ADS^%^22^%^3Afalse^%^2C^%^22FT_BF_GOOGLE_ADS_LIFETIME^%^22^%^3A30^%^2C^%^22isOperatedByGlobalE^%^22^%^3Afalse^%^2C^%^22isPiiDataEnabled^%^22^%^3Atrue^%^2C^%^22isEventSendingDelayed^%^22^%^3Afalse^%^7D^%^2C^%^22lockBrowsingStartOnSessionId^%^22^%^3A^%^22ede9b5fe-485a-4869-b47f-1d90ab1947dd^%^22^%^2C^%^22dataUpdatedAt^%^22^%^3A1780173563897^%^2C^%^22environment^%^22^%^3A^%^22PRODUCTION^%^22^%^7D; lastRskxRun=1780173563952; pxcts=KvJMxW9w3aoe1UXWR/T8-M/vlhk0vzRb0jaghRZQ0kA=:2pqYpnBE6uMlX1wO0mtRM87HmStQnJKsqhGyt3uBK3BRZvK64ZPNbVIFR9udHLzb2pkGygoozSXRLA9ZQkYra3l9mLEhjGkgbxDQkJGgB5qGvK5BInpa3KJTZvPbv2BmuBy4wcrdVfzrJnRraDI6mtSwFkMDdCUpGBSx1LCF8z9FJuM8/-DU-q3607/v-w4O; ttcsid_C2HEIAAQV140ORDJ26VG=1780173566870::a7rZoQhBw2V9txJ2RT2s.2.1780173588285.1; s_nr=1780173599815-Repeat; ttcsid=1780173563253::t2pFmVuklYgOB6GbA89H.1.1780173588285.0::1.-4457.0::39529.5.1708.1962::38106.5.1882^"""  # <-- paste here


def _clean_cookie(raw: str) -> str:
    """Strip Windows CMD cURL escape sequences from a pasted cookie string."""
    c = raw
    c = c.replace("^%^", "%")
    c = c.replace(r'^\"', '"')
    c = c.replace(r'^\^"', '"')
    c = c.replace('^"', "")
    c = c.replace("^&", "&")
    c = c.replace("^{", "{")
    c = c.replace("^}", "}")
    c = c.replace("^[", "[")
    c = c.replace("^]", "]")
    c = c.strip('"').strip("'")
    return c


COOKIE = _clean_cookie(COOKIE_RAW)


# ── DATABASE ──────────────────────────────────────────────────────────────────
DB_URL = "postgresql://postgres.cdjuosvljudidvyxdfwn:RJkU3AvtaV2BuBGy@aws-1-us-east-1.pooler.supabase.com:5432/postgres"


# ── CATEGORIES TO FETCH ───────────────────────────────────────────────────────
# Format: (cgid, label, aesthetic, garment_type, gender)
#
# cgid = the category ID used in Pacsun's Search-ShowAjax URL
# Find it: browse pacsun.com -> click a category -> check the URL or Network tab
#
# aesthetic must match one of the 41 aesthetics in the Stitch app exactly
# garment_type: "tops", "bottoms", "outerwear", "shoes", "accessories"
# gender: "male", "female", "both"
CATEGORIES = [
    # ── MENS ──────────────────────────────────────────────────────────────────
    ("mens-clothing",          "mens clothing",         "Streetwear",  "tops",      "male"),
    ("mens-graphic-tees",      "mens graphic tees",     "Streetwear",  "tops",      "male"),
    ("mens-hoodies-sweatshirts","mens hoodies",         "Streetwear",  "tops",      "male"),
    ("mens-jeans",             "mens jeans",            "Streetwear",  "bottoms",   "male"),
    ("mens-pants",             "mens pants",            "Streetwear",  "bottoms",   "male"),
    ("mens-shorts",            "mens shorts",           "Streetwear",  "bottoms",   "male"),
    ("mens-jackets",           "mens jackets",          "Streetwear",  "outerwear", "male"),
    ("mens-shirts",            "mens shirts",           "Minimalist",  "tops",      "male"),
    ("mens-sweaters",          "mens sweaters",         "Minimalist",  "tops",      "male"),
    ("mens-shoes",             "mens shoes",            "Streetwear",  "shoes",     "male"),

    # ── WOMENS ────────────────────────────────────────────────────────────────
    ("womens-clothing",        "womens clothing",       "Y2K",         "tops",      "female"),
    ("womens-graphic-tees",    "womens graphic tees",   "Y2K",         "tops",      "female"),
    ("womens-hoodies-sweatshirts","womens hoodies",     "Soft Girl",   "tops",      "female"),
    ("womens-jeans",           "womens jeans",          "Y2K",         "bottoms",   "female"),
    ("womens-pants",           "womens pants",          "Y2K",         "bottoms",   "female"),
    ("womens-shorts",          "womens shorts",         "Y2K",         "bottoms",   "female"),
    ("womens-jackets",         "womens jackets",        "Streetwear",  "outerwear", "female"),
    ("womens-dresses",         "womens dresses",        "Coquette",    "tops",      "female"),
    ("womens-shoes",           "womens shoes",          "Y2K",         "shoes",     "female"),
]


# ── CONFIG ────────────────────────────────────────────────────────────────────
MAX_PAGES_PER_CATEGORY = 999    # effectively unlimited — stops when Pacsun returns no more products
PAGE_SIZE = 24                  # Pacsun returns 24 products per page
DELAY_SECS = 2.0                # seconds between requests (be polite, avoid triggering bot detection)
DRY_RUN = False                 # set True to test without writing to DB

BASE_URL = "https://www.pacsun.com"
AJAX_ENDPOINT = "/on/demandware.store/Sites-pacsun-Site/default/Search-ShowAjax"


def make_headers(referer="https://www.pacsun.com/mens/"):
    """Headers that mimic a real Chrome browser on Windows."""
    return {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "cookie": COOKIE,
        "origin": BASE_URL,
        "referer": referer,
        "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
        "x-requested-with": "XMLHttpRequest",
    }


def load_existing_urls(conn):
    """
    Load all product URLs already in the cache into a set for O(1) dedup lookup.
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT listing->>'url'
        FROM depop_cache,
        jsonb_array_elements(listings) AS listing
        WHERE jsonb_typeof(listings) = 'array'
          AND listing->>'url' IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()
    return set(row[0] for row in rows)


def fetch_category_page(cgid, page):
    """
    Fetch one page of products from Pacsun's Search-ShowAjax endpoint.

    The endpoint returns HTML containing product card markup.
    Each page has up to PAGE_SIZE (24) products.

    Returns the raw HTML string, or None on failure.
    """
    selected_url = f"/on/demandware.store/Sites-pacsun-Site/default/Search-ShowAjax?cgid={cgid}"
    params = {
        "cgid": cgid,
        "page": page,
        "selectedUrl": selected_url,
    }
    referer = f"{BASE_URL}/{cgid.replace('-', '/', 1)}/"  # e.g. /mens/clothing/

    resp = requests.get(
        BASE_URL + AJAX_ENDPOINT,
        headers=make_headers(referer),
        params=params,
        timeout=20,
    )

    if resp.status_code == 403:
        print(f"    ✗ 403 Forbidden — cookies expired, grab fresh ones from DevTools")
        return None
    if resp.status_code != 200:
        print(f"    ✗ HTTP {resp.status_code}")
        return None
    if len(resp.text) < 100:
        return None

    return resp.text


def parse_products_from_html(html, cgid):
    """
    Parse product cards from Pacsun's Search-ShowAjax HTML response.

    Pacsun renders product tiles as HTML. Each tile contains:
    - A link with the product URL (href ending in .html)
    - An <img> tag with the product image
    - Price and title in data attributes or text nodes

    We try multiple extraction strategies in order of reliability:
    1. JSON-LD structured data (<script type="application/ld+json">)
    2. Open Graph meta tags (og:title, og:image, og:price:amount)
    3. HTML data attributes on product tile elements
    4. Regex on raw HTML as last resort

    Returns a list of dicts with title, price, image, url.
    """
    soup = BeautifulSoup(html, "html.parser")
    products = []

    # Strategy 1: Look for product tile links with data attributes
    # Pacsun product tiles have class "product-tile" or similar
    tiles = soup.select("div.product-tile, article.product-tile, div[data-pid]")

    for tile in tiles:
        try:
            # Get product URL from the first <a> link inside the tile
            link = tile.select_one("a[href]")
            if not link:
                continue
            href = link.get("href", "")
            # Pacsun product URLs end with a 13-digit ID before .html
            if not re.search(r"-\d{13}\.html", href):
                continue
            url = href if href.startswith("http") else BASE_URL + href

            # Get title from data-name attribute, alt text, or link text
            title = (
                tile.get("data-name") or
                tile.get("data-product-name") or
                link.get("title") or
                tile.select_one("img[alt]") and tile.select_one("img[alt]").get("alt") or
                tile.select_one(".product-name, .pdp-link a, h2, h3") and
                tile.select_one(".product-name, .pdp-link a, h2, h3").get_text(strip=True) or
                ""
            )

            # Get image URL
            img = tile.select_one("img[src], img[data-src]")
            image = ""
            if img:
                image = img.get("src") or img.get("data-src") or ""
                if image and not image.startswith("http"):
                    image = BASE_URL + image

            # Get price from data attribute or text
            price_raw = (
                tile.get("data-price") or
                tile.select_one(".price .value, .sales .value, span[content]") and
                (tile.select_one(".price .value, .sales .value, span[content]").get("content") or
                 tile.select_one(".price .value, .sales .value").get_text(strip=True)) or
                ""
            )
            price = f"${price_raw}" if price_raw and not str(price_raw).startswith("$") else str(price_raw) or "N/A"

            if not title or not url:
                continue

            products.append({
                "title": title,
                "price": price,
                "image": image,
                "url": url,
            })

        except Exception:
            continue

    # Strategy 2: If tile parsing found nothing, try regex on product links
    if not products:
        # Find all product page links
        link_matches = re.findall(r'href="(https?://[^"]*-\d{13}\.html[^"]*)"', html)
        link_matches += re.findall(r'href="(/[^"]*-\d{13}\.html[^"]*)"', html)

        seen = set()
        for href in link_matches:
            url = href if href.startswith("http") else BASE_URL + href
            if url in seen:
                continue
            seen.add(url)

            # Extract slug as title fallback
            slug = url.split("/")[-1].replace(".html", "")
            title = re.sub(r"-\d{13}$", "", slug).replace("-", " ").title()

            # Find nearby image
            idx = html.find(href)
            nearby = html[max(0, idx-500):idx+500]
            img_match = re.search(r'src="(https://[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"', nearby)
            image = img_match.group(1) if img_match else ""

            # Find price
            price_match = re.search(r'\$(\d+\.\d{2})', nearby)
            price = f"${price_match.group(1)}" if price_match else "N/A"

            products.append({
                "title": title,
                "price": price,
                "image": image,
                "url": url,
            })

    return products


def upsert_to_db(conn, query_key, aesthetic, garment_type, gender, listings):
    """Insert listings into depop_cache, appending to existing rows for this key."""
    if not listings or DRY_RUN:
        if DRY_RUN:
            print(f"    [DRY RUN] Would insert {len(listings)} listings")
        return

    cur = conn.cursor()
    cur.execute("""
        INSERT INTO depop_cache (query, listings, aesthetic, garment_type, permanent, created_at)
        VALUES (%s, %s::jsonb, %s, %s, true, NOW())
        ON CONFLICT (query) DO UPDATE
        SET listings = depop_cache.listings || EXCLUDED.listings::jsonb
    """, (query_key, json.dumps(listings), aesthetic, garment_type))
    conn.commit()
    cur.close()
    print(f"    ✓ Inserted {len(listings)} listings")


def main():
    if not COOKIE_RAW:
        print("ERROR: Paste your Pacsun cookie string into COOKIE_RAW = \"\" at the top")
        print("Get it: pacsun.com -> DevTools (F12) -> Network -> any request -> Headers -> cookie:")
        return

    print("=" * 60)
    print("Stitch — Pacsun Category Scraper")
    print("=" * 60)

    conn = psycopg2.connect(DB_URL, sslmode="require")
    print("✓ Connected to database\n")

    existing_urls = load_existing_urls(conn)
    print(f"✓ Loaded {len(existing_urls)} existing URLs from cache\n")

    total_inserted = 0

    for cgid, label, aesthetic, garment_type, gender in CATEGORIES:
        print(f"\n── Category '{cgid}': {label} -> {aesthetic}/{garment_type}/{gender} ──")

        all_listings = []
        consecutive_zero_new = 0

        for page in range(MAX_PAGES_PER_CATEGORY):
            print(f"  Page {page}...")
            html = fetch_category_page(cgid, page)

            if html is None:
                print(f"  Request failed — stopping this category")
                break

            products = parse_products_from_html(html, cgid)

            # No products parsed at all = truly empty page, we're done
            if not products:
                print(f"  No products on page {page} — end of category")
                break

            new_count = 0
            for p in products:
                if not p.get("url"):
                    continue
                if p["url"] in existing_urls:
                    continue  # already cached

                existing_urls.add(p["url"])
                slug = p["url"].split("/")[-1].replace(".html", "")

                listing = {
                    "title": p["title"],
                    "price": p["price"],
                    "image": p["image"],
                    "url": p["url"],
                    "seller": "pacsun",
                    "slug": slug,
                    "query": label,
                    "_gender": gender,
                    "_source": "pacsun",
                }
                all_listings.append(listing)
                new_count += 1
                print(f"    ✓ {p['title'][:60]} — {p['price']}")

            print(f"  Page {page}: {new_count} new / {len(products)} total")

            # Stop if fewer than a full page returned — last page
            if len(products) < PAGE_SIZE:
                print(f"  Last page reached (got {len(products)} < {PAGE_SIZE})")
                break

            # Stop if 2 consecutive pages had zero new products (all already cached)
            if new_count == 0:
                consecutive_zero_new += 1
                if consecutive_zero_new >= 2:
                    print(f"  2 consecutive pages fully cached — stopping")
                    break
            else:
                consecutive_zero_new = 0

            time.sleep(DELAY_SECS)

        # Insert all collected listings for this category
        cache_key = f"pacsun {label}"
        upsert_to_db(conn, cache_key, aesthetic, garment_type, gender, all_listings)
        total_inserted += len(all_listings)

        time.sleep(DELAY_SECS)

    conn.close()
    print(f"\n{'=' * 60}")
    print(f"Done! Inserted {total_inserted} products total")


if __name__ == "__main__":
    main()
