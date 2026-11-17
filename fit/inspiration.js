/* ═══════════════════════════════════════════════════════════
   Leanline: daily inspiration (Bible verses + quotes)

   Scripture texts in this work are taken from the New American Bible,
   revised edition © 2010, 1991, 1986, 1970 Confraternity of Christian
   Doctrine, Washington, D.C. and are used by permission of the copyright
   owner. All Rights Reserved. No part of the New American Bible may be
   reproduced in any form without permission in writing from the
   copyright owner.
   Verse text copied from bible.usccb.org.
═══════════════════════════════════════════════════════════ */
'use strict';
const NABRE_NOTICE = 'Scripture texts in this work are taken from the New American Bible, revised edition © 2010, 1991, 1986, 1970 Confraternity of Christian Doctrine, Washington, D.C. and are used by permission of the copyright owner. All Rights Reserved. No part of the New American Bible may be reproduced in any form without permission in writing from the copyright owner.';
const VERSES = [
 {
  "ref": "Philippians 4:13",
  "t": "I have the strength for everything through him who empowers me."
 },
 {
  "ref": "Philippians 4:6–7",
  "t": "Have no anxiety at all, but in everything, by prayer and petition, with thanksgiving, make your requests known to God. Then the peace of God that surpasses all understanding will guard your hearts and minds in Christ Jesus."
 },
 {
  "ref": "Philippians 3:13–14",
  "t": "Brothers, I for my part do not consider myself to have taken possession. Just one thing: forgetting what lies behind but straining forward to what lies ahead, I continue my pursuit toward the goal, the prize of God’s upward calling, in Christ Jesus."
 },
 {
  "ref": "Isaiah 40:31",
  "t": "They that hope in the LORD will renew their strength, they will soar on eagles’ wings; They will run and not grow weary, walk and not grow faint."
 },
 {
  "ref": "Isaiah 41:10",
  "t": "Do not fear: I am with you; do not be anxious: I am your God. I will strengthen you, I will help you, I will uphold you with my victorious right hand."
 },
 {
  "ref": "Jeremiah 29:11",
  "t": "For I know well the plans I have in mind for you—oracle of the LORD—plans for your welfare and not for woe, so as to give you a future of hope."
 },
 {
  "ref": "1 Corinthians 6:19–20",
  "t": "Do you not know that your body is a temple of the holy Spirit within you, whom you have from God, and that you are not your own? For you have been purchased at a price. Therefore, glorify God in your body."
 },
 {
  "ref": "1 Corinthians 9:24",
  "t": "Do you not know that the runners in the stadium all run in the race, but only one wins the prize? Run so as to win."
 },
 {
  "ref": "1 Corinthians 10:13",
  "t": "No trial has come to you but what is human. God is faithful and will not let you be tried beyond your strength; but with the trial he will also provide a way out, so that you may be able to bear it."
 },
 {
  "ref": "1 Corinthians 10:31",
  "t": "So whether you eat or drink, or whatever you do, do everything for the glory of God."
 },
 {
  "ref": "1 Corinthians 16:13–14",
  "t": "Be on your guard, stand firm in the faith, be courageous, be strong. Your every act should be done with love."
 },
 {
  "ref": "2 Corinthians 4:16",
  "t": "Therefore, we are not discouraged; rather, although our outer self is wasting away, our inner self is being renewed day by day."
 },
 {
  "ref": "Galatians 6:9",
  "t": "Let us not grow tired of doing good, for in due time we shall reap our harvest, if we do not give up."
 },
 {
  "ref": "Hebrews 12:1",
  "t": "Therefore, since we are surrounded by so great a cloud of witnesses, let us rid ourselves of every burden and sin that clings to us and persevere in running the race that lies before us…"
 },
 {
  "ref": "Hebrews 12:11",
  "t": "At the time, all discipline seems a cause not for joy but for pain, yet later it brings the peaceful fruit of righteousness to those who are trained by it."
 },
 {
  "ref": "Psalm 118:24",
  "t": "This is the day the LORD has made; let us rejoice in it and be glad."
 },
 {
  "ref": "Psalm 37:5",
  "t": "Commit your way to the LORD; trust in him and he will act…"
 },
 {
  "ref": "Matthew 19:26",
  "t": "Jesus looked at them and said, “For human beings this is impossible, but for God all things are possible.”"
 },
 {
  "ref": "Lamentations 3:22–23",
  "t": "The LORD’s acts of mercy are not exhausted, his compassion is not spent; They are renewed each morning—great is your faithfulness!"
 },
 {
  "ref": "Nehemiah 8:10",
  "t": "…Do not be saddened this day, for rejoicing in the LORD is your strength!"
 }
];
/** Quotes without an author are Leanline's own. */
const QUOTES = [
 {
  "t": "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
  "by": "Will Durant"
 },
 {
  "t": "Do what you can, with what you have, where you are.",
  "by": "Theodore Roosevelt"
 },
 {
  "t": "A journey of a thousand miles begins with a single step.",
  "by": "Lao Tzu"
 },
 {
  "t": "Fall seven times, stand up eight.",
  "by": "Japanese proverb"
 },
 {
  "t": "Pray, hope, and don't worry.",
  "by": "St. Padre Pio"
 },
 {
  "t": "Courage doesn't always roar. Sometimes courage is the quiet voice at the end of the day saying, \"I will try again tomorrow.\"",
  "by": "Mary Anne Radmacher"
 },
 {
  "t": "The man who moves a mountain begins by carrying away small stones.",
  "by": "Chinese proverb"
 },
 {
  "t": "Small steps every day add up to big results.",
  "by": null
 },
 {
  "t": "You don't have to be perfect, just consistent.",
  "by": null
 },
 {
  "t": "Discipline is choosing what you want most over what you want now.",
  "by": null
 },
 {
  "t": "One meal at a time. One day at a time.",
  "by": null
 },
 {
  "t": "Your future self is watching. Make them proud.",
  "by": null
 },
 {
  "t": "Strong is built, not given.",
  "by": null
 },
 {
  "t": "A slow week is still forward motion.",
  "by": null
 },
 {
  "t": "Logging is a superpower. Awareness changes everything.",
  "by": null
 },
 {
  "t": "Every rep, every step, every choice counts.",
  "by": null
 },
 {
  "t": "You've survived 100% of your hardest days.",
  "by": null
 },
 {
  "t": "Progress, not perfection.",
  "by": null
 },
 {
  "t": "The best project you'll ever work on is you.",
  "by": null
 },
 {
  "t": "Don't count the days. Make the days count.",
  "by": null
 }
];
