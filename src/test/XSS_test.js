{
  let y = async (url, originUrl = '') => await XSS.maybe({originUrl, url, method: "GET"});
  let n = async (...args) => !await y(...args);
  Promise.all([
      () => y("https://noscript.net/<script"),
      () => n("https://noscript.net/<script", "https://noscript.net/"),
      () => y("https://vulnerabledoma.in/char_test?body=%80%3Cscript%3Ealert(1)%3C/script%3E"),
      () => y("https://vulnerabledoma.in/char_test?body=%3Cp%20id=x%3Ejavascrip%3Cx%3Et:alert(%3Cx%3E1)%3C/p%3E%3Cmath%3E%3Ca%20href=%22%23*/=x.innerText,a%22%20xml:base=javascript:location/*%3EClick%20HERE"),
      () => y("https://vulnerabledoma.in/char_test?body=%3Cp%20id=x%3E%26lt%3Bsv%3Cx%3Eg%20o%3Cx%3Enload=alert(%3Cx%3E1)%3E%3C/p%3E%3Cmath%3E%3Ca%20href=%23%250ax.innerText%20xml:base=javascript:%3C!--%3EClick%20HERE"),
      () => y("https://vulnerabledoma.in/char_test?body=%3Cp%20id=x%3E%26lt%3Bsv%3Cx%3Eg%20o%3Cx%3Enload=alert(%3Cx%3E1)%3E%3C/p%3E%3Cmath%3E%3Ca%20href=%23*/x.innerText%20xml:base=%01javascript:/*%3EClick%20HERE"),
      () => y("https://vulnerabledoma.in/char_test?body=%3Ca%20href=javascript%26colo%u0000n%3balert%281%u0029%3ECLICK"),
      () => y("https://vulnerabledoma.in/xss_link?url=javascript%26colo%00n%3Balert%u00281%29"),
      () => y("https://vulnerabledoma.in/xss_link?url=javascript:\\u{%0A6e}ame"),
      ].map(t => Test.run(t))
    ).then(() => Test.report());
}
