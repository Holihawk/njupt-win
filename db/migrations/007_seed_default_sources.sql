INSERT INTO sources (
  id, name, base_url, list_url, source_type, parser_type,
  official_weight, auto_crawl, enabled, notes
) VALUES
  (
    'njupt-main',
    '南京邮电大学官网',
    'https://www.njupt.edu.cn',
    'https://www.njupt.edu.cn/72/list.htm',
    'notice',
    'webplus',
    1.00,
    true,
    true,
    '项目默认公开通知来源'
  ),
  (
    'njupt-jwc',
    '南京邮电大学本科生院',
    'https://jwc.njupt.edu.cn',
    'https://jwc.njupt.edu.cn/1594/list.htm',
    'notice',
    'webplus',
    1.00,
    true,
    true,
    '项目默认公开通知来源'
  )
ON CONFLICT (id) DO NOTHING;
