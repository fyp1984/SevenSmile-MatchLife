import { BookOpen, LockKeyhole, Sparkles, Workflow } from 'lucide-react';

export default function Guide() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-16 pt-4 sm:pt-6">
      <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-brand-brown sm:text-3xl">系统使用说明</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-brand-gray sm:text-base">
              先看这里，能快速知道去哪查比赛、去哪看排行、哪里更新数据。
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-extrabold text-brand-brown">系统功能</h2>
          </div>
          <ul className="space-y-2 text-sm leading-6 text-brand-gray">
            <li>首页快速查比赛、选手和比分。</li>
            <li>赛事看板集中看赛况和成绩。</li>
            <li>排行榜按项目和条件查看表现。</li>
            <li>比赛详情页可继续看对阵和过程。</li>
            <li>管理员可维护赛事与选手资料。</li>
          </ul>
        </div>

        <div className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <Workflow className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-extrabold text-brand-brown">操作流程</h2>
          </div>
          <ol className="space-y-2 text-sm leading-6 text-brand-gray">
            <li>1. 先在首页输入关键词。</li>
            <li>2. 想看整体情况就进“赛事看板”。</li>
            <li>3. 想看个人表现就进“排行榜”或选手页。</li>
            <li>4. 页面未更新时先看“更新状态”。</li>
            <li>5. 需要维护资料时再进入后台操作。</li>
          </ol>
        </div>

        <div className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <div className="mb-4 flex items-center gap-3">
            <LockKeyhole className="h-5 w-5 text-orange-500" />
            <h2 className="text-lg font-extrabold text-brand-brown">权限管控</h2>
          </div>
          <ul className="space-y-2 text-sm leading-6 text-brand-gray">
            <li>普通用户可查看首页、看板、排行榜和比赛详情。</li>
            <li>编辑和删除资料时需要管理员口令。</li>
            <li>赛事资料建议固定人员维护，避免重复改动。</li>
            <li>如无权限，优先联系管理员处理。</li>
          </ul>
        </div>
      </section>

      <section className="rounded-[28px] border border-orange-100 bg-white/80 p-5 shadow-sm backdrop-blur-sm sm:p-7">
        <h2 className="text-xl font-extrabold text-brand-brown">常见使用场景</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-orange-100 bg-orange-50/40 p-5">
            <h3 className="text-base font-extrabold text-brand-brown">查找某场比赛</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              在首页输入选手、赛事或组别关键词，就能快速找到相关结果。
            </p>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-white p-5">
            <h3 className="text-base font-extrabold text-brand-brown">查看赛事整体情况</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              进入“赛事看板”，选择赛事后即可查看进展和排名。
            </p>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-white p-5">
            <h3 className="text-base font-extrabold text-brand-brown">维护选手档案</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              管理员可补充头像、俱乐部和教练等基础信息。
            </p>
          </div>
          <div className="rounded-3xl border border-orange-100 bg-orange-50/40 p-5">
            <h3 className="text-base font-extrabold text-brand-brown">处理异常情况</h3>
            <p className="mt-2 text-sm leading-6 text-brand-gray">
              页面没更新时先看“更新状态”；需要改资料时请联系管理员。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
