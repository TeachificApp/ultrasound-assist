#!/usr/bin/env node
/**
 * Copy Manus Forge CDN assets into the configured Cloudflare R2 bucket.
 *
 * Defaults are scoped to the All About Ultrasound bucket provided in this branch:
 *   Source: https://d2xsxph8kpxj0f.cloudfront.net/310519663401463434/UrcfdRVE8J6mpMNR48QuFe/
 *   R2 API: https://926e046281eccc776864fd105e322ac8.r2.cloudflarestorage.com/ultrasound-assist
 *   Public: https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev
 *
 * Required to upload:
 *   CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY
 *   (R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY and AWS_* aliases also work)
 *
 * Optional:
 *   DATABASE_URL or MYSQL_URL        Discover every stored Manus CDN URL in the DB
 *   --manifest-file <path>           Include additional source URLs or relative keys from CSV/text
 *   --no-explicit-manifest           Skip the built-in explicit manifest
 *   --manifest-only                  Upload only the explicit manifest below
 *   --dry-run                        Print planned copies without downloading/uploading
 */
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { createPool } from "mysql2/promise";

const SOURCE_BASE =
  process.env.MANUS_CDN_BASE ??
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663401463434/UrcfdRVE8J6mpMNR48QuFe/";
const R2_BUCKET_URL =
  process.env.CLOUDFLARE_R2_BUCKET_URL ??
  process.env.CLOUDFLARE_R2_BUCKET_API ??
  process.env.CLOUDFLARE_R2_S3 ??
  process.env.R2_BUCKET_URL ??
  "https://926e046281eccc776864fd105e322ac8.r2.cloudflarestorage.com/ultrasound-assist";
const R2_PUBLIC_BASE_URL =
  process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ??
  process.env.CLOUDFLARE_PUBLIC_DEVEL_URL ??
  process.env.R2_PUBLIC_BASE_URL ??
  "https://pub-1f4b81c70d1f49cb8817cc2abbb92288.r2.dev";
const R2_ACCESS_KEY_ID =
  process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ??
  process.env.CLOUDFARE_R2_ACCESS_KEY_ID ??
  process.env.R2_ACCESS_KEY_ID ??
  process.env.AWS_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY =
  process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ??
  process.env.CLOUDFLARE_SECRET_ACCESS_KEY ??
  process.env.CLOUDFARE_SECRET_ACCESS_KEY ??
  process.env.CLOUDFARER2_TOKENVALUE ??
  process.env.R2_SECRET_ACCESS_KEY ??
  process.env.AWS_SECRET_ACCESS_KEY;
const DATABASE_URL = process.env.DATABASE_URL ?? process.env.MYSQL_URL ?? process.env.railway_database_url;

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const manifestOnly = args.has("--manifest-only");
const includeExplicitManifest = !args.has("--no-explicit-manifest");
const skipExisting = !args.has("--overwrite");
const manifestFile = optionValue("--manifest-file", "--manifest", "--csv");

const explicitManifest = [
  // Scan Coach Images
  "scancoach/abdominal/aorta/echo-Abdominal-Aorta-Distal_Labels.png",
  "scancoach/abdominal/aorta/echo-Abdominal-Aorta-Labels.png",
  "scancoach/abdominal/gallbladder/echo-CBD1-label.png",
  "scancoach/abdominal/gallbladder/echo-Gallbladder_labels.png",
  "scancoach/abdominal/ivc/echo-IVC1-labels.png",
  "scancoach/abdominal/kidneys/echo-Left_Kidney-Spleen.jpg",
  "scancoach/abdominal/kidneys/echo-Right_Kidney-Labels.jpg",
  "scancoach/abdominal/liver/echo-LIVER1_portal_Veins.jpg",
  "scancoach/abdominal/liver/echo-LIVER2_Hep_Veins1.jpg",
  "scancoach/abdominal/liver/echo-LIVER_kidney.png",
  "scancoach/abdominal/pancreas/echo-Panc-Labels.png",
  "scancoach/abdominal/spleen/echo-Spleen-labels.png",
  "scancoach/pelvic_gyn/adnexa/echo-OV_TA-Doppler.jpg",
  "scancoach/pelvic_gyn/adnexa/echo-OV_TA.jpg",
  "scancoach/pelvic_gyn/cul_de_sac/echo-Uterus_-_CuldeSac-label.jpg",
  "scancoach/pelvic_gyn/uterus_sag/echo-Uterus_-_TV-labels.jpg",
  "scancoach/pelvic_gyn/uterus_sag/echo-Uterus_SAG-labels.jpg",

  // Media Repo / SCORM
  "media-repo/registry-review-quiz-physics-spi-unlimited-59a18a7b/v1-UNLIMITED REGISTRY REVIEW QUIZ - PHYSICS SPI.zip",
  "media-repo/lms-cover-1-1c5910bf/cover-1c5910bf.png",

  // Digital Download
  "digital-downloads/1/co5d1x-How to Start an Ultrasound Business.pdf",

  // LMS Images
  "lms-images/0e5015047b2e.png",
  "lms-images/8c05ebd71789.png",

  // Static app shell / email assets
  "aaus_icon_180_teal_246d56e7.png",
  "aaus_icon_192_2af50158.png",
  "aaus_icon_192_teal_f0c966ce.png",
  "aaus_icon_512_teal_840494a6.png",
  "aaus_logo_8a52a6c6.webp",
  "aaus_logo_e47ffb71.png",
  "aaus_logo_ring_01cc7ccd.webp",
  "caselibrary-banner-final_AAUS_4bee1eff.webp",
  "daily-challenge-banner-v3_AAUS_ccb55bf0.webp",
  "flashcards-banner-final_AAUS_94ef5d55.webp",
  "soundbytes-banner-AAUS_8880afff.png",
  "ultrasound-hero-probe-3bWMAQMJw9YFHoPXwbt8bZ.webp",
];

const explicitMappedManifest = [
  {"sourceUrl": "https://d2xsxph8kpxj0f.cloudfront.net/310519663401463434/etVPnUidWNWG8W4GHnRqzv/pocus-icon_0b2e6eff.png", "key": "static/pocus-icon_0b2e6eff.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/pwtXDnxySsEwDrgH.png?Expires=1804217678&Signature=RjLvt9Fs6sbCplyJuBgyeMa3moRHLqXSn5sgXkxbmEMk4zq8JyWJ3uhIlW4xlIMySe1iUKmIoWUsxw9p9gF96ayg9wsQylH0Nf9uugH4tvoyJl4HQcDNZU~eh1UNmWKF2MXx7bp9FDJAKsHla8WuCu6j7rQv50qEaNFCJOqs3cRpoGZNyQhABCzpMPopJJR-V7rzIrebcwNPvB8Zg8J5g2gIr3FW1OVQhuO8G4zOKG2u69c~yiQEdqnxcUd5JeBGdxlMIR5wvaKUn384nUBMhSO1rhEq6WN2eHyFtVZNVnWb0ZPPPP-zYaA5Y8tzPs70r~IuAvDl8uPMxmtIWx8elw__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/sweep.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/ZMTandoYWqCfTVQG.png?Expires=1804219541&Signature=FFw3aLQMd681Ktzg35mIlyajenWZXm5SUyNpFH4Jy~AHqYVioMYaUNqtxZ410Uq9GoNPRcBd6W~zQ5~ddPDzfo7jHB6sc7B~DlmsQcWFSYre6CLyWRhxYC~CBrJk2bq0oh84jf5WLgoc95f70H3wOc~JamfxXXSOE70VM~~2jd~2rQOm5vkLA6QzLMvZANC2XAPlaAoKhGk-Hkfjv4Y7WTlcudoywE2Wmkk-5zHslwi~DDh9UJjeS6HE6wNVfb0Gu9uytxKRAS3r65i8TeH4zNq7kZStckHZmpiPOCgEFg3nKq7UZFIfnyanhi37z9~E3sS5MSbrQX89pvWMEfaHnQ__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/abdominalSitusDiagram.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/oJAqycRWgaGIHUKy.png?Expires=1804219546&Signature=r2K1V3-P-GnIhbORET95gATIoTUFWXd4AxZeqCiDXB1yXQJUXk6rojvOLenXmx~VmkqxROoBJmxj6onaUz62nTTQY4QDKKW1zhZvxCH9yANnYkXZPy-nsmnEeqQCAq~CutfguKZSfj5wub~YDQ7voe2y38IZQqC6TcG-rk7ZElwB~GRqAXhFwJ5p3zlfzhCWZXt8SyXk0rCtfdGVuz1JYqz9QMZ3mGBkz-Zbe4ETNy~Rc0f1OmWAL0M9NDGp~xKExY9cpKO581Z6MbeV9aJ3IbdNMwy~7xsBtXbuJPGxt880EuruzfcVom0mlQj7I9uGX-Fa-1QlQ9Rp9FCxJB9njw__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoAbdominalSitus.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/CLtSxqdZHBcCumkP.png?Expires=1804217683&Signature=VOxwYTn3wPLwSAG0YLL5zwY5flGx68Jw1pRhxySaq219-kolUuyAnCsaARBvuiZ0EdFnpZjTg-9ikyzFAcXWaog7l~T17sj9zDG5p7bVmBDBQckRWNOCxJW4emBzz-qlyvSMpyXcBBLAPXas~OB5TV2R7GJwN86IbGuYujQnAlR5WsY2lnCC9DTrIjsqdXZS1C-EOjS8X3Gzj5gim6FQYDTRr4U-B28fH0~gbJxskTbEZpuXG20W9U-J9jtvnUHhK2GG-amhyQ13s4M82UX7Le~~JrGHXMjrdhM73ZLNyxJVgiYETzpPyj9GiTwu~Q2sr6mWZA5HjnRWKLfCnX1mww__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/fourChamber.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/FsCsjnyeqmklIFoo.gif?Expires=1804233214&Signature=Jo-rvA0xYhTpV7FpI0syHloTxxRoJiBlV0rJI1~IGZecYYEx3f4yNshsAc8ax0QpKf~B53bd8QD2kiBTZe~ervKNZTE2ZpCDbVck9siO8HP-RafW3dUV7LyxpcfKqbjpXCQf5yWWIuJnFBm45zPPA3ungtCqppNxY~4h2cw0r0a0MKWvuSh8fUe0Aht54BF4NZ1vQWqs7kl6hQO2XVtQR8vRvAzKCjj8XzWbg78n8heVnyN-1hI9PTD9aQTEsKaHX2e7wGlgkeFiJiNQMXUtkZi9PuGWsrAVC7zmXyDs0UTCjwdMeVFmWWX43Eb6uSDB6-gjrisk3YVxrk5VgRBJgw__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoFourChamber.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/HGAQPXIReqfTNBKy.png?Expires=1804217687&Signature=T-bR51dg0rI8c71vd~9W491Gd2a5cjZQ17GFS-RQW7zqc58OE4pAQbhUnMQl7Q0D8qj9gzdYl3BbkQX34XEYBGw~Ha7uD5j62v8cJ7Wk-wMPFdD1p-DhmCyMBhQBw-Hv3uOutyxhKZjOflH4MWJkkuuNdRGATanGjZGDdbu3lZWjLRJFoY3Y8nwQiUFNppYJZejwUgT~0nBkIEo5Kr0-igVQzPrDcmk7z0xhHhluDBgGknAbnW2LnrtLnusr0AK2~TyHUa9JzQ9RXX4VS3nKLpq4bopk1cLFz7YIM-AvsIgfFIIW2TFFFMEIOPRr9focbem9CDh7~TlzNFtqYh~FDg__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/lvot.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/yKTaXDyqcalQLhSz.gif?Expires=1804233215&Signature=g4HbckpFIDhN6fx3cSxgsyvYDzMyWlpOkTxc97yWNiiKiPd6lAf5E2uJ-YSOLEFe8tdyvqjhXDPV4u1oZNL8AJ7JrT4OHaJksXCOW4OzI0QBoE2GPUWgquV616lITbBm2L96i9s0Da5~~Y9UJITA0lZEZWb78XnvO-lFo0iWEhjcqRQvfvzuhHkstx637ZQxyhW48GQ1ma5I9RFW60ImcpVLyt68Ce6Ja8K~2eE-qOS6~-9hUlPN31WoF653il1zAueq8W11fopkD14LiQu2YYKWJirqbb0s0NVGJhcR9dzHTw4jjywnHOt5e4P1SCZkKkw666ocYWVQH3eq~7KBbg__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoLvot.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/zkMTTtxmdDbJFPnT.png?Expires=1804217677&Signature=V4cp7hA2Vxz5atyyJ8Yf0xJ3P8ZqagZR95YqE-M1oK5TqjCU4LF4Qhp2MduyF4N0qoHaWeyClQ5zMlUd29ACTMXbrFxP~6bNQIDqAz7jTtLxwykK3s9BHsyqhmHpomzoFJo~3JsDFUtaJU0EAe18sFHpWjRVZFWaP7jt9SyJwet2KLQMo-1Bv0QZXAmzG7R7QnaMgarZXI-EHqMexKk1Jet8iQRYBF3FkF3PQ9IiEvI4FggvcECes7ISyqrSprlFiNbP1iy5qrZzpAkSyc3p5hh8-Lh4FhUTk-vysmW4iHMkNm8KV0ylswYQCkpYAC3QHa0G8If-RroFHveEo8L8-A__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/rvot.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/mfSQNxAuERDAcTEN.gif?Expires=1804233215&Signature=KMndkGZCsadxq8BfXsFHLTQWw3BUy3JdWA8kxttgOr2q2LRCiqYvDrRrza5fnvQa1jjxaWzXVlVQY5N9pJSQzm99yqlUt44jcD4dPN4scbRgjiVGOS2CE7yC7x4k5YoZkacVrUw1MSLlRUXdaZdSEDhyiF3IhGYim2wdRHlL7mV~20bP7dRQP2q9nV6KqjLc-645Zqa0N3WFX1fK04ZTka26BTDi8P6n6gjqo5MXEGmz3FEKIh8oD4tk6QTcMBo~YdAanw8fO1p399X2o8YHJCks7ft97X2TO00wTEtugZkcNsVQgYlLDrx1Wx6ulw0mLAyBZ9Ho49~0LARfOT1XlA__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoRvot.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/GJOvhZIPNnIgAQHJ.png?Expires=1804217677&Signature=DE1TDX9Xf4hMNW5e-clWZiIE978WXpn3gem83T5ZCyWak6ow~kp1aOal6LNqjRpC7fJ-UDQUS4carcg5RUNMWTNDQ~8Wb11MYxn0FfoujGIER3e0Iw56cOrJp2cEBCM5~DfQEtjtu3ELZW-wKLAtTuDfyYCeEquCqrE32eI4da1yy~2kpfdBHUR2Jl9ts3O4kwHwLmOoVnLhDiZGmF8EPHFeQgSLSwbDXGfk4QJ8z0WZwOT2B81YakA0VgAQbstTmR2~pZrT7OhHD1dg3-Pr3tYH0bC3yhRVd7ZhgnmK39sjd3ihjJ0fUf2fUCyhBOwGnviqKjs05pjM6a3Fnai6OA__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/rvotBifurcation.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/kjNujbopvYeXuXRd.png?Expires=1804219531&Signature=EtSFpEBvcFTPWEa5CBlr89rmS8MMPCHN4QwtQ1TGHb202PKKEEeYq5MadcYUTWLq7miAnnnwXls7ViZu~-349O4ki3lmeRRjGlIog7m4KazgEoJmQX6jzm2kgtCZS6-SjbTUlEK4tiGbkJofCe~hq7E-q9xULBwy2pyF1tYn6mFrIYOOzBJgSohf0KSoxWFkSjpY7UTDMGtIUmJb4A0i~RO7Wb~~oIvqZfQOzLZMeOfINzdG5r6SoJoXaCLWiUmNOnN4SDvIMj7kbPQbM9e4~wyAdH5HOrYENIfBMZ2-8L1aZQpnX6xXo3~ksdUxKMJsahORgJYa0sa362bD9TSUBw__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoRvotBifurcation.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/tqIbdiftEiCjCtBg.png?Expires=1804217678&Signature=C6FTzFhtUc5TnxTwnvOO8K-~5y7vUwR9ZY-ndHTL~W6Y1~DU6JRY-CVCxtXqiM4npoJtq7BrgNNWQ7l8AdysUP2gB9g~I89JzVd0Xbxgrw6Cj2CLI5wAVpMTjDMBXxhHZyJtxNHHM8at81J2-aqsbxllARyMKMuq3yViQHLhZ7IiP~R14zDpFDn8KfXcpRTQbrYlJXu2G76L4Kuvn4G3rJVhpI4bEzAUKo4SNEeNJkHsH9YQpuqyzNQ93uPzpDxzwk09wR9CoyUMW-ZGBm~JKB6KNBnYSWXWY~Qrbp5OBuPk3doqj5n7vFqZO3kmQ1IS89rWDrDwxGilXuYqb8o6hA__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/threeVVDuctal.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/tqrBgqVGzZDYoeXM.png?Expires=1804219557&Signature=CDFJzl4ikVN-wm7kjYAzoizilDf9Iv6EBn~R71yWirmTgSC53Poukur~PZNKd26ndivYsur2qwZk3Ek7XE9oFNED3UhQVk0IHnBm4t8wm6lHZsjRH7dUTuGGKLYVC2BiPm6rHxBTTn94UtcOvAmlsYyazQgGiaKp5BkNcOQYYZaeLS-yQ0hkJmBVbGreICidn6NmxWkgP-ies5kHeJg6IO72epeSJFV0QfgxLVwLUp0jZ1D5j0cL17GwVsk1RtDbJ09Q6VN~IORZGWznv7EGAw3t0317AJ~2i5p6ZyZdKKMoDQOlCQcKP8ITqsOe~99Sc6AVkmxFzFxaYfmjZdQE~A__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoThreeVVDuctal.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/wXdhYtXSmjdILGLY.png?Expires=1804217678&Signature=AbYSjgEbF67spokqJE6r0QiY-amruwTq9ND5JdHR0VAnHM2LUJJcqwwVKI6xkXbbXFXthhMfWWVhNPrQYoWhfuKiejlnwBD84A2MRxS~PHqlkobnY1mshHUA8Mk1a1gvxk0b9rmy7TPiO6PDNBr2yeP0d4HHB5qveWfZV6Ef6N8ujxuxsWUGDGy4H~FvgwksZGIaPRCznwi1G5WEp3Bx-8jlj6FkvQTlJsRo-mhb5REPXlqDXDKtgzQW-t6Hrl3lmxYUgFA~3Mp4uM4WMbf--Oq0CSi3nMlNIIDWuCRZ22CSG8C9C9-cl6K0BquXgBoKRxJ8Xn0fRzWaErym-y3-Pg__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/threeVT.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/ViQyJlALqrvWVEph.gif?Expires=1804233216&Signature=hR0jVOZM3YaZV9QOcE1TuzhklM6UJz9fNcOsNODCk~PU2mXsB7AaeMvsvV8d0CiOD7~TgcW8ql2MaPbLQiuzkX4FvSZ~JC1Tszv-qASoqsp4NMiwL3Vb7IPGQZlbxPGK21RhU412Q3emtUqPQ32bDeB9C-bdtPEkQTmNoIOfPukOIEiJOFRlTo8ZQGygYTBEofmhnT6X55FIV7r314~IHXYHvGQUe53TdqbYWnkrAKy6dkNIOAqyOXvvn41YOzZsbetKy1U1kXMIKNvbYTKcgxh6w2oSOlYeVkMeWqy1mMCEJVnItNbweHg4hsGT3lsc5N3w8o5zBaPa6h9XMdyAkg__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoThreeVT.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/vRqqlQSitiQuZxSJ.png?Expires=1804217678&Signature=XacRQ2a0loWf3gCJH2fWU~KTUNBawZUALgm6ZeTq5bTLjnycjlI15ykab6dSXGO82fiuyczm9ePOC1vwpJ76ZyYkS7f2ZHO~BAGREmsYOxdmb-jDbaZP3e9MfC9F~5JNFeQPcFXXEEKKAkFbhtYfF8nOub3tZHkcuonV~JW3Yr5rDSOAn6KKAHRttn2zy895eBqOzLozU2eHtWwSN3Pcfan1y7fZBeyrz-26R0wj~nWDcWSC6tPEg90g5ycjMx74E5LAC2UzXJiBVVVoRvf~IZsdnKk7WWqOEWDLW9rMRYPIA2PkapLOs7BM88PV0q0McPe0N8kZZiW4p5AGi-fsDg__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/bcv.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/VizJommhsipdzIeA.png?Expires=1804219531&Signature=XYTjAWg9IqlCByRfuqWLeJXN-QsTAi-KPfu5csTu50s41cV9Q1DlYx6bwvbg69-Aakl0Uft0rMPQcD96hppPaDU-QuNYZOgu8x0-66yMpIqD5mcny7cTMaQIN-lIfqUCGfo5uHVHDSjZcDcACv1PogJLqYu7RTUCbvRVx4GZNp7JW5xTY09cznC6YJFT60gIUvx9nso6rHc~JlsCMjJ1GXiv~7hIab~PEghsjLIam2Pxpyv8~qIiPfByRfYeJz0Y9dl3l4NQ5ND5Y9XREXmqm6slDL10~YEiItHVi6FeHczsEcTd8MZj1A~2D3-il5DWnvdSYVfc~k4F0Sx1GU3QUQ__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoLbvc.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/vQTOAothgRTPuaXI.gif?Expires=1804233216&Signature=pXA93W5yVReHPuxvtUUDsys-TV7UlEN1k37XkiZZViCxzfCfQDnET0hMKIg0URmyfPXm-dTha7qRP0LZSDMETBzIQrdIKCsjrosMXdYgHG7niz7dYe6GZBJj2-av8vddtG3p5Rk3XDZ-GdLBsHQLfoiY--ICtRwsCJqCxvSQo~zt2WI8OQh5iSyGMMKr-ANTFib8a8hXWeshGuLB8ObDkjltkxUxHVJ0z7pryZXRLa5AxFWp4hS4Bs70Tcl~rWKzPb7D0TJqnD0tvhBXh3fDN3NhBlfNCv7gBTxBe0sRDXDHgmQpYQqXsow35-ntBFSfNB8iXcI1K2unUHtI2uy21A__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoLvShortAxis.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/eAzSlcLjWuskBlIM.png?Expires=1804233087&Signature=sDbjIEusdQS3ymQSQy61DT5drOjwCubFVtpxsRn9KIz85ry2cstjOtQhGRgqiT2nFZuV3cCUGfmOV8TM7yZuB8JidA0Ut3lioFv6VrsCyR1dFl7nnUEX9o3zZRJOuf2~t~zPNym8Ru5GqiOHTkjEehT6Sw~QWi9~XVaJ9mWRPBaSdltkacu09bZii-Z~lz3Rb8XjcIONdtW4-HrRbTA4-dSoFcTk3g9Tz4G7D1XNODaUKSyIYopNAtly-nexHYUVrXFTyzS3xn9myjCf5zcLqAlU9xk1vfcBOUC7EBPQo6EITrr3r4MLmDbN~5G8spe9JwccHkYJZI-yL~aufeHudg__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/fetalRvotSaxAnatomy.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/DIECWLBAWgIaNYNW.gif?Expires=1804233215&Signature=Wxc0ufcYwvkFut37XoiZY7FaEFyGBx0xEUPRmtaua79GJpC3NRKEK27TmiwHX-IuuWFK65JgRGP3fYPqGoeKg9ztup5tHl3OsBZe5W4weWO-aKAj63y3EkesP9JhJ6gN3RHX4CnO3Ca3IzVH~AqsM7Skw~o~sSQ3vlIGGJDvDLpezG364WNprJXTBU-AgC9K~is9lKg~5gOeohZSLxdVHJDM026zJl~o8Gzt-m1fGGpBC27F9rQrgLORnT9EQlbNTfQUjOa7AXzblZHK2u7Xyp5Lk3lOHlc9WiTVKoZEZgJFQAcy03Nmg2fmbBQ__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoRvotShortAxis.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/BFlsjzXHQURCTgXJ.png?Expires=1804217678&Signature=Rf32-AAr~a1IBc1WxrGdLCuI4XZPy9ov4CEuKdg68bE~b71p8o52rAKqCbi5UfU6SAhkJI6fGPcWLli5B90y24re5WX2Q9wOIXBefLgEzPLnHY9a~EniZUij48wwPA6De0eQ7UPgVSMAgswXcmOYcNMM~lsO3PVp-3F1gVyj0Y0RD4UACDSyxMXgZAYzaTfxzLTIjHI4zbXhxZMFnDL8w3zr5FUTZefcqrV95fYKwZQm2d3mrx3Lw~8XTIWcEQZ1uOx~2GJnLopHAvOPtJqhVjLOLvr9~7X~1JuTGs3YTz3R6g4JJjmaX17xJDvFo3b2M6twyqGU~H0DqZwCL1t0fw__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/bicaval.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/XLCPDDlQZLNxHWxC.gif?Expires=1804233216&Signature=CcVMmOffRsFpxh4KAiCQwUbbH~IomT3QLkOiniMUD3i6i2MFPH~WjX62H1Em8QYz~KcIiwyUaqSeRfburxSkMe1vm3nAgYtsPtXBjz2INHrbq2gO4MCDn4nzGHko0iaVIZMK3PxfoukVX6H6jw5i5OIgs7pi-eZOqS7NEybsaC4PPmKqRDkYYKAY52fF4EHHBgpjI36whW-7bxz-JAI7cJTaPuj0wDPVss7m~oY3ngaEJsP1zswt7WseSQMM2CoEhbyRWPd2eU1JhnbHDQ1OdK58Dioq9lhROpD9vBLbfQr~6ywjat7oGs1eeXMFeQF7hfXKCDalAhW-fJE8gC6nbA__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoBicaval.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/TKlJMYtocuCBKwbl.png?Expires=1804217678&Signature=eojPUlijwGlowVGglOvcT3zQY-LR8gK11wJQnfC2qZlnkawEQfTx~e1s8wviyiQcQsp7dMfGrw5NN8m98ofDYz7OYUjLTd7jzv56cr6X5m12PJRJndtZOiNvSBd3QNgHNZ3gZaV3QaiM-ozMrtEQMZWL11l0LhmLcTGnc9wULnDMyqTm1RvcBrbZMZLagDQkuAO~fQOtDHZSDVh2DVXfQtC7teCqYSUwVGBM0NpG6T0~ocdAs2~Kn00TrPLtjo32iPwq8U3ndb9c0lRT75MMwUAZG4M5KPed--PbAYiS2UK465P-5-~DCboWpSXbbsCqzHi74BAd8kNv15-1K67dug__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/aorticArch.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/UBqhGFAUZIxSaYgz.gif?Expires=1804233217&Signature=pBsnwYkwIrnLqcz-Og27cM9NUMx6Fji0JZbDzVO~SournpTlFFOYr2TRjC0Eeo6Cvt7SroEIm3nE2hCmLBCKfr8vamp8Sk-I0r~XeMfb8jc5OOcr286gVyWIVBVNpnsYsftXuaUviZ39h~nNj-HI5lpO6SNrudOfBPPjKSs7AyRXcahyvrBS4zujQ6bbJgLdmcLgU93PlXKx6~Mo1Ox73J97ZliDqtJM-686nDaMY9LONoxDHK5FvIT7Zlz-ece3NNtmYcg1RNeMURm3u6AwVgsMEPR1YpmWrLSD1SeKDP7RciW-g9CzImYEO4jJeYDFVsOYdhqEZloqE2IDB1T8Yw__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoAorticArch.gif"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/bvrodzhIwNApIBbC.png?Expires=1804217678&Signature=oZ4LyOOcoHxUHXmU-o~9dtNQd1~0O9GQRuEVBx9Bbg0NKvsBOtAhAeIBbWJJe2AJ-AlfN3N66m7sNGnvKorUkixgyqosSbhG7bnpmZoY~aFIPjDMn0Vtd0t3QrIrzmRe3JIY8frK0xo8dBhQeHI1HjKsHdHebttaz5vjkha34mBXEtFVUMPAbK-lQMeobbcZkpipsuJ1aYnIAslKeZLJwr8-d7D4LrB4oYf70rKffMyeZZ3XCLKPm19tUAktTgomn0UfIy9jCHQgjPWHMP-tNob~MMtURGRM0uzX1Vq1rsojj2pwsUYpz6haOGG1KBt1f8OU2IRLyK4oJT6aoMHsxg__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/ductalArch.png"},
  {"sourceUrl": "https://private-us-east-1.manuscdn.com/user_upload_by_module/session_file/310519663401463434/niftMrorwLRVixtq.gif?Expires=1804233217&Signature=Ei2xvaGjnBEglQVKoM1GOyE5s5U-lWFu~e70vn8IbqgC398vxNhqx0TPGmBqpOT6oage7x3dNlHUw8jvDMWuSPT6ZWflKPjQqAVnGoEWKtSCtMO1bbal9ZzOaUzl3KhL1o-EJmKnZWIpId1ao5C7ClccGMjlY2u2jJXXSt~8NZd3TktyLwrnQXWDdw6N5-qTuwoHSOtw0cXPX7siTFJbJHP1YJGSjG4pH-OvboqaMezD7nNwZ6TmJG39zUzxd84arcosAEGHHlxTsU5eiIZKMqjCIPbipoaoG1ThuUBE9q5vdUa-La68F2vT5ntMZIALMIxz4Q~eUkkBkmUsel-YbA__&Key-Pair-Id=K2HSFNDJXOU9YS", "key": "fetal-scan-coach/echoDuctalArch.gif"},
];

function normalizeBase(base) {
  return base.endsWith("/") ? base : `${base}/`;
}

function optionValue(...names) {
  for (const name of names) {
    const index = argv.indexOf(name);
    if (index !== -1) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${name} requires a file path`);
      }
      return value;
    }

    const prefix = `${name}=`;
    const inline = argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
  }
  return null;
}

function parseR2BucketUrl(bucketUrl) {
  const parsed = new URL(bucketUrl);
  const bucketFromPath = parsed.pathname.split("/").filter(Boolean)[0];
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return {
    endpoint: (process.env.CLOUDFLARE_R2_ENDPOINT ?? "").replace(/\/+$/, "") || parsed.origin,
    bucket:
      process.env.CLOUDFLARE_R2_BUCKET ??
      process.env.CLOUDFLARE_BUCKET_NAME ??
      process.env.R2_BUCKET ??
      bucketFromPath ??
      "ultrasound-assist",
  };
}

function publicUrlForKey(key) {
  return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function sourceUrlForKey(key) {
  return new URL(key, normalizeBase(SOURCE_BASE)).toString();
}

function keyFromSourceUrl(sourceUrl) {
  const base = normalizeBase(SOURCE_BASE);
  if (!sourceUrl.startsWith(base)) return null;
  return decodeURIComponent(sourceUrl.slice(base.length)).replace(/^\/+/, "");
}

function extractSourceUrls(value) {
  if (typeof value !== "string" || !value.includes(SOURCE_BASE.replace(/\/$/, ""))) return [];
  const escapedBase = SOURCE_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\/$/, "\\/?");
  const regex = new RegExp(`${escapedBase}[^"'\\\\\\s<>)]+`, "g");
  return value.match(regex) ?? [];
}

function parseDelimitedCells(value) {
  const cells = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    const next = value[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && (char === "," || char === "\t" || char === ";" || char === "\n" || char === "\r")) {
      cells.push(cell);
      cell = "";
      continue;
    }

    cell += char;
  }

  cells.push(cell);
  return cells;
}

async function loadManifestUrls(filePath) {
  if (!filePath) return [];

  const buffer = await readFile(filePath);
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    throw new Error(
      `${filePath} appears to be an XLSX/ZIP file. This script expects a real CSV/text file; export the workbook as CSV before passing it to --manifest-file.`
    );
  }

  const text = buffer.toString("utf8");
  const urls = new Set(extractSourceUrls(text));
  const base = normalizeBase(SOURCE_BASE);
  const baseWithoutSlash = SOURCE_BASE.replace(/\/$/, "");
  const headerNames = new Set(["url", "urls", "source", "source_url", "source url", "key", "path", "file", "file_url", "file url"]);

  for (const rawCell of parseDelimitedCells(text)) {
    const cell = rawCell.trim().replace(/^\uFEFF/, "");
    if (!cell || headerNames.has(cell.toLowerCase())) continue;

    if (cell.startsWith(base) || cell.startsWith(baseWithoutSlash)) {
      urls.add(cell);
      continue;
    }

    if (/^https?:\/\//i.test(cell)) {
      console.warn(`[manifest] Skipping non-source URL: ${cell}`);
      continue;
    }

    if (cell.includes("/")) {
      urls.add(sourceUrlForKey(cell));
    }
  }

  return Array.from(urls);
}

async function discoverDbUrls() {
  if (!DATABASE_URL || manifestOnly) return [];

  const pool = createPool({
    uri: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectTimeout: 10000,
  });

  try {
    const [[dbRow]] = await pool.query("SELECT DATABASE() AS dbName");
    const databaseName = dbRow?.dbName;
    if (!databaseName) return [];

    const [columns] = await pool.query(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND DATA_TYPE IN ('varchar','text','mediumtext','longtext','json')`,
      [databaseName]
    );

    const urls = new Set();
    const likeValue = `%${SOURCE_BASE.replace(/\/$/, "")}%`;
    for (const { tableName, columnName } of columns) {
      const safeTable = `\`${String(tableName).replace(/`/g, "``")}\``;
      const safeColumn = `\`${String(columnName).replace(/`/g, "``")}\``;
      try {
        const [rows] = await pool.query(
          `SELECT ${safeColumn} AS value FROM ${safeTable} WHERE ${safeColumn} LIKE ? LIMIT 5000`,
          [likeValue]
        );
        for (const row of rows) {
          for (const url of extractSourceUrls(row.value)) urls.add(url);
        }
      } catch (err) {
        console.warn(`[discover] Skipping ${tableName}.${columnName}: ${err.message}`);
      }
    }
    return Array.from(urls);
  } finally {
    await pool.end();
  }
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound") return false;
    throw err;
  }
}

async function copyAsset(client, bucket, item) {
  if (dryRun) {
    console.log(`[dry-run] ${item.sourceUrl} -> ${item.publicUrl}`);
    return { status: "dry-run", key: item.key };
  }

  if (skipExisting && await objectExists(client, bucket, item.key)) {
    console.log(`[skip] ${item.key} already exists`);
    return { status: "skipped", key: item.key };
  }

  const sourceResponse = await fetch(item.sourceUrl);
  if (!sourceResponse.ok) {
    throw new Error(`Download failed for ${item.sourceUrl}: HTTP ${sourceResponse.status}`);
  }

  const body = Buffer.from(await sourceResponse.arrayBuffer());
  const contentType = sourceResponse.headers.get("content-type") ?? "application/octet-stream";
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: item.key,
    Body: body,
    ContentType: contentType,
  }));

  console.log(`[copied] ${item.key} -> ${item.publicUrl}`);
  return { status: "copied", key: item.key };
}

async function main() {
  const explicitItems = includeExplicitManifest
    ? [
        ...explicitManifest.map((key) => ({ key, sourceUrl: sourceUrlForKey(key), publicUrl: publicUrlForKey(key) })),
        ...explicitMappedManifest.map((item) => ({ ...item, publicUrl: publicUrlForKey(item.key) })),
      ]
    : [];
  const manifestUrls = await loadManifestUrls(manifestFile);
  const dbUrls = await discoverDbUrls();
  const discoveredItems = Array.from(new Set([...manifestUrls, ...dbUrls]))
    .map((sourceUrl) => {
      const key = keyFromSourceUrl(sourceUrl);
      return key ? { key, sourceUrl, publicUrl: publicUrlForKey(key) } : null;
    })
    .filter(Boolean);
  const itemMap = new Map();
  for (const item of [...explicitItems, ...discoveredItems]) itemMap.set(item.key, item);
  const items = Array.from(itemMap.values()).sort((a, b) => a.key.localeCompare(b.key));

  console.log(`Planned R2 migration items: ${items.length}`);
  console.log(`Explicit manifest items: ${explicitItems.length}`);
  if (manifestFile) console.log(`Manifest file items: ${manifestUrls.length}`);
  if (!manifestOnly) console.log(`Discovered DB URLs: ${dbUrls.length}`);

  if (!dryRun && (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
    throw new Error("R2 credentials missing: set CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY");
  }

  const { endpoint, bucket } = parseR2BucketUrl(R2_BUCKET_URL);
  const client = dryRun ? null : new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const summary = { copied: 0, skipped: 0, failed: 0, dryRun: 0 };
  for (const item of items) {
    try {
      const result = await copyAsset(client, bucket, item);
      if (result.status === "copied") summary.copied++;
      if (result.status === "skipped") summary.skipped++;
      if (result.status === "dry-run") summary.dryRun++;
    } catch (err) {
      summary.failed++;
      console.error(`[failed] ${item.key}: ${err.message}`);
    }
  }

  console.log("Migration summary:", summary);
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
