import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Activity, Calendar, Trophy, ChevronRight } from "lucide-react";

export function PlayerCareer() {
  const { name } = useParams();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
        <ArrowLeft className="w-4 h-4" />
        <span>返回搜索</span>
      </Link>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8 flex flex-col md:flex-row items-center gap-8">
        <div className="w-32 h-32 bg-gradient-to-br from-brand-100 to-brand-300 rounded-full flex items-center justify-center text-4xl font-extrabold text-brand-800 shadow-inner">
          {name?.substring(0, 2) || "选手"}
        </div>
        <div className="flex-1 text-center md:text-left space-y-4">
          <h1 className="text-3xl md:text-4xl font-extrabold text-text-main">{name || "选手档案"}</h1>
          <div className="flex flex-wrap justify-center md:justify-start gap-4">
            <div className="bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 text-center">
              <div className="text-2xl font-black text-brand-600">42</div>
              <div className="text-xs text-text-sub font-medium">总参赛场次</div>
            </div>
            <div className="bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 text-center">
              <div className="text-2xl font-black text-brand-600">31</div>
              <div className="text-xs text-text-sub font-medium">胜场数</div>
            </div>
            <div className="bg-gradient-to-br from-brand-500 to-brand-600 px-4 py-2 rounded-xl border border-brand-100 text-center text-white shadow-md">
              <div className="text-2xl font-black">73.8%</div>
              <div className="text-xs font-medium opacity-90">总胜率</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
        <h2 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
          <Activity className="w-6 h-6 text-brand-500" />
          <span>生涯时间轴</span>
        </h2>
        
        <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-brand-200 before:to-transparent">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-brand-500 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                {i % 2 === 0 ? <Activity className="w-4 h-4" /> : <Trophy className="w-4 h-4" />}
              </div>
              
              <Link to={`/matches/${i}`} className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] p-4 rounded-2xl border border-brand-100 bg-white shadow-sm hover:shadow-md hover:border-brand-300 transition-all flex justify-between items-center group-hover:-translate-y-1">
                <div>
                  <div className="text-sm text-text-sub flex items-center gap-1 mb-1">
                    <Calendar className="w-3 h-3" />
                    <span>2026-04-{10+i}</span>
                  </div>
                  <h3 className="font-bold text-text-main">2026年全国U系列比赛</h3>
                  <div className="text-sm font-medium mt-2 flex items-center gap-2">
                    <span className={i % 2 === 0 ? "text-text-sub" : "text-brand-600 font-bold"}>{name}</span>
                    <span className="px-2 py-0.5 bg-gray-100 rounded-full text-xs">2 : 1</span>
                    <span className={i % 2 === 0 ? "text-brand-600 font-bold" : "text-text-sub"}>对手{i}</span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-brand-300 group-hover:text-brand-500" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
