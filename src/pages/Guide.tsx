import { BookOpen, LockKeyhole, Sparkles, Workflow } from 'lucide-react';

export default function Guide() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-20 pt-4 sm:pt-6">
      <section className="rounded-[28px] border border-orange-100 bg-white/80 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-brand-brown sm:text-3xl">系统使用说明</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-brand-gray sm:text-base">
              这里重点介绍系统能做什么、日常怎么使用，以及哪些操作需要管理员口令。内容面向终端使用人员，可作为快速上手指引。
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-[28px] border border-orange-100 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-extrabold text-brand-brown">系统功能</h2>
          </div>
          <ul className="space-y-2 text-sm leading-6 text-brand-gray">
            <li>首页可快速检索比赛、选手、赛事和场地信息。</li>
            <li>赛事看板可查看某个赛事的整体进展和项目成绩。</li>
            <li>排行榜可按男女、单打、双打查看选手表现。</li>
            <li>比赛详情页可查看对阵信息、比分和相关比赛。</li>
            <li>管理员可在后台维护赛事与选手资料。</li>
          </ul>
        </div>

        <div className="rounded-[28px] border border-orange-100 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <Workflow className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-extrabold text-brand-brown">操作流程</h2>
          </div>
          <ol className="space-y-2 text-sm leading-6 text-brand-gray">
            <li>1. 先在首页输入关键词，快速找到目标比赛或选手。</li>
            <li>2. 如需查看整体情况，可进入“赛事看板”查看统计结果。</li>
            <li>3. 如需查看个人表现，可进入“排行榜”或“选手页”。</li>
            <li>4. 管理员可在后台维护赛事来源和选手资料。</li>
            <li>5. 如页面未更新，可先查看“更新状态”确认最新结果是否已整理完成。</li>
          </ol>
        </div>

        <div className="rounded-[28px] border border-orange-100 bg-white/80 p-6 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <LockKeyhole className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-extrabold text-brand-brown">权限管控</h2>
          </div>
          <ul className="space-y-2 text-sm leading-6 text-brand-gray">
            <li>普通用户可查看首页、看板、排行榜和比赛详情。</li>
            <li>涉及档案编辑、档案删除等管理操作时，需要输入管理员口令。</li>
            <li>赛事资料的维护建议由专人负责，避免多人同时改动。</li>
            <li>后续会进一步升级管理员权限控制。</li>
          </ul>
        </div>
      </section>

      <section className="rounded-[28px] border border-orange-100 bg-white/80 p-6 shadow-sm backdrop-blur-sm sm:p-8">
        <h2 className="text-xl font-extrabold text-brand-brown">常见使用场景</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-orange-100 bg-orange-50/40 p-5">
            <h3 className="text-base font-extrabold text-brand-brown">查找某场比赛</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              在首页输入选手姓名、赛事名称、场地或组别关键词，即可快速查看相关比赛结果。
            </p>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-white p-5">
            <h3 className="text-base font-extrabold text-brand-brown">查看赛事整体情况</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              进入“赛事看板”，选择目标赛事后即可查看比赛数量、项目分布和各项目排名。
            </p>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-white p-5">
            <h3 className="text-base font-extrabold text-brand-brown">维护选手档案</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              管理员可在后台完善头像、俱乐部、教练等信息，让展示页面更完整。
            </p>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-orange-50/40 p-5">
            <h3 className="text-base font-extrabold text-brand-brown">处理异常情况</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              若页面未显示最新结果，先查看“更新状态”；若需调整赛事资料，请由有口令的管理员处理。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
