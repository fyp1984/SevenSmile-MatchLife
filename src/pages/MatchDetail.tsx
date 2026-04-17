import { Link } from "react-router-dom";
import { ArrowLeft, Calendar, MapPin, Trophy } from "lucide-react";

export function MatchDetail() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center space-x-2 text-brand-600 hover:text-brand-700 font-medium">
        <ArrowLeft className="w-4 h-4" />
        <span>返回搜索</span>
      </Link>

      <div className="bg-white/80 backdrop-blur-sm rounded-3xl shadow-sm border border-brand-100 p-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8 border-b border-brand-100 pb-8">
          <div className="text-center md:text-left">
            <span className="inline-block px-3 py-1 bg-accent-yellow/20 text-text-main rounded-full text-xs font-bold mb-3">
              U12-14组别
            </span>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-main mb-2">2026年全国U系列羽毛球比赛</h1>
            <div className="flex items-center justify-center md:justify-start space-x-4 text-text-sub text-sm">
              <span className="flex items-center space-x-1"><Calendar className="w-4 h-4" /><span>2026-04-15</span></span>
              <span className="flex items-center space-x-1"><MapPin className="w-4 h-4" /><span>北京赛区</span></span>
            </div>
          </div>
          
          <div className="flex flex-col items-center">
            <span className="text-sm text-text-sub mb-1">来源平台更新</span>
            <span className="text-brand-600 font-medium">2小时前</span>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 my-12">
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 bg-gradient-to-br from-brand-100 to-brand-200 rounded-full flex items-center justify-center text-2xl font-bold text-brand-800 shadow-inner mb-4 relative">
              李林
              <div className="absolute -top-2 -right-2 bg-accent-yellow text-white p-1.5 rounded-full shadow-sm">
                <Trophy className="w-4 h-4" />
              </div>
            </div>
            <Link to="/player/李林" className="text-lg font-bold text-text-main hover:text-brand-600 transition-colors">李林</Link>
            <span className="text-green-500 font-medium text-sm mt-1">胜者</span>
          </div>

          <div className="flex flex-col items-center space-y-2">
            <div className="text-5xl font-black text-brand-600 tracking-wider">2 : 1</div>
            <div className="text-text-sub font-medium text-lg">21-19, 18-21, 21-15</div>
            <div className="px-4 py-1 bg-brand-50 text-brand-600 rounded-full text-sm font-bold mt-2">已完赛</div>
          </div>

          <div className="flex flex-col items-center">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center text-2xl font-bold text-gray-600 shadow-inner mb-4">
              张伟
            </div>
            <Link to="/player/张伟" className="text-lg font-bold text-text-main hover:text-brand-600 transition-colors">张伟</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
