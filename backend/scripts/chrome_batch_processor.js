window.__norm = function(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
};

window.__processBatch = async function(targets) {
  const allClubs = window.__allEngageClubs || [];
  const results = [];
  
  for (const target of targets) {
    const tNorm = window.__norm(target.name);
    // Find match in allClubs
    let match = allClubs.find(c => window.__norm(c.name) === tNorm);
    if (!match) {
      match = allClubs.find(c => {
        const cn = window.__norm(c.name);
        return cn.includes(tNorm) || tNorm.includes(cn);
      });
    }
    
    const resItem = {
      name: target.name,
      slug: target.slug,
      organization_id: target.organization_id,
      matched: !!match,
      engageData: match || null,
      homeData: null,
      source_urls: ['https://engage.usc.edu/club_signup?view=all']
    };
    
    const engageUrl = (match && match.website && match.website.includes('engage.usc.edu')) 
      ? match.website 
      : (target.engage_url && target.engage_url.includes('engage.usc.edu') ? target.engage_url : null);
      
    if (engageUrl) {
      resItem.source_urls.push(engageUrl);
      try {
        const homeUrl = engageUrl.endsWith('/') ? engageUrl + 'home/' : engageUrl + '/home/';
        const homeRes = await fetch(homeUrl);
        if (homeRes.ok) {
          resItem.source_urls.push(homeUrl);
          const homeHtml = await homeRes.text();
          const doc = new DOMParser().parseFromString(homeHtml, 'text/html');
          const bodyText = doc.body.innerText;
          
          // Counts
          const offMatch = bodyText.match(/(\d+)\s*\n+\s*Officers/i);
          const memMatch = bodyText.match(/(\d+)\s*\n+\s*Members/i);
          const evMatch = bodyText.match(/(\d+)\s*\n+\s*Events/i);
          
          // Shared email
          const mailto = Array.from(doc.querySelectorAll('a[href^="mailto:"]'))
            .map(a => a.href.replace(/^mailto:/i, '').split('?')[0].trim())
            .filter(e => e && !e.includes('uscedu') && !e.includes('campusgroups.com') && !e.includes('example.com'));
            
          const emailRegex = bodyText.match(/(?:E:\s*|Email:\s*|Contact:\s*)([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
          
          // Social links (filter USC defaults)
          const socialLinks = {};
          const uscDefaults = ['instagram.com/uscedu', 'facebook.com/usc', 'twitter.com/usc', 'linkedin.com/school/3084', 'youtube.com/user/USC', 'linkedin.com/school/usc'];
          const links = Array.from(doc.querySelectorAll('a[href]'));
          for (const a of links) {
            const h = a.href;
            if (uscDefaults.some(d => h.toLowerCase().includes(d.toLowerCase()))) continue;
            if (h.includes('instagram.com/')) socialLinks['instagram'] = h;
            else if (h.includes('linkedin.com/company/')) socialLinks['linkedin'] = h;
            else if (h.includes('facebook.com/')) socialLinks['facebook'] = h;
            else if (h.includes('twitter.com/') || h.includes('x.com/')) socialLinks['x'] = h;
            else if (h.includes('discord.gg/') || h.includes('discord.com/')) socialLinks['discord'] = h;
            else if (h.includes('youtube.com/')) socialLinks['youtube'] = h;
          }
          
          resItem.homeData = {
            officer_count: offMatch ? parseInt(offMatch[1]) : null,
            member_count: memMatch ? parseInt(memMatch[1]) : null,
            event_count: evMatch ? parseInt(evMatch[1]) : null,
            shared_email: mailto[0] || (emailRegex ? emailRegex[1] : null),
            social_links: socialLinks
          };
        }
      } catch (err) {
        resItem.homeError = err.message;
      }
    }
    
    results.push(resItem);
  }
  return results;
};
